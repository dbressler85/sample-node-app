'use strict';

// Unit tests for the device-origin read cache (src/deviceReadCache.js) — the device counterpart to the
// backend's shared readCache. Pins the behavior device-origin depends on: cross-consumer coalescing,
// TTL matched to the backend tiers, no cached failures, and clear-on-write. The device fetch path itself
// is build-verified; this locks the pure caching logic. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const cache = require('../src/deviceReadCache');

test('key: type+league+SORTED params (param order does not split the entry; FRANCHISE does)', () => {
  assert.equal(cache.key('rosters', '1', { L: '1', FRANCHISE: '0001' }), cache.key('rosters', '1', { FRANCHISE: '0001', L: '1' }), 'param order is normalized');
  assert.notEqual(cache.key('rosters', '1', {}), cache.key('rosters', '1', { FRANCHISE: '0001' }), 'all-franchise vs FRANCHISE=me are distinct entries');
  assert.notEqual(cache.key('rosters', '1', {}), cache.key('rosters', '2', {}), 'different leagues are distinct');
});

test('TTL tiers match the backend (5m default, draftResults 12s, calendar 1h)', () => {
  assert.equal(cache.ttlFor('rosters'), 5 * 60 * 1000);
  assert.equal(cache.ttlFor('leagueStandings'), 5 * 60 * 1000);
  assert.equal(cache.ttlFor('draftResults'), 12 * 1000);
  assert.equal(cache.ttlFor('calendar'), 60 * 60 * 1000);
  assert.equal(cache.ttlFor('somethingElse'), cache.DEFAULT_TTL_MS);
});

test('coalesce: concurrent consumers of the same read share ONE fetch', async () => {
  cache.clear();
  let fetches = 0;
  const fetcher = () => { fetches += 1; return Promise.resolve(['R']); };
  const [a, b, c] = await Promise.all([
    cache.get('rosters', '1', {}, fetcher, 1000),
    cache.get('rosters', '1', {}, fetcher, 1000),
    cache.get('rosters', '1', {}, fetcher, 1000),
  ]);
  assert.equal(fetches, 1, 'three concurrent reads → one fetch');
  assert.deepEqual(a, ['R']);
  assert.equal(a, b, 'same resolved value shared');
  assert.equal(b, c);
});

test('TTL: a hit within the window is reused; past it, re-fetches', async () => {
  cache.clear();
  let fetches = 0;
  const fetcher = () => { fetches += 1; return Promise.resolve(fetches); };
  await cache.get('rosters', '1', {}, fetcher, 0);
  await cache.get('rosters', '1', {}, fetcher, 4 * 60 * 1000); // within 5m
  assert.equal(fetches, 1, 'within TTL → no new fetch');
  await cache.get('rosters', '1', {}, fetcher, 5 * 60 * 1000 + 1); // past 5m
  assert.equal(fetches, 2, 'past TTL → re-fetch');
});

test('draftResults uses the short (12s) tier', async () => {
  cache.clear();
  let fetches = 0;
  const fetcher = () => { fetches += 1; return Promise.resolve(fetches); };
  await cache.get('draftResults', '1', {}, fetcher, 0);
  await cache.get('draftResults', '1', {}, fetcher, 11 * 1000); // within 12s
  assert.equal(fetches, 1, 'within 12s → reused');
  await cache.get('draftResults', '1', {}, fetcher, 13 * 1000); // past 12s
  assert.equal(fetches, 2, 'past 12s → re-fetch (fresh during a live draft)');
});

test('a rejected read is NOT cached — the next call retries', async () => {
  cache.clear();
  let calls = 0;
  const flaky = () => { calls += 1; return calls === 1 ? Promise.reject(new Error('429')) : Promise.resolve('ok'); };
  await assert.rejects(() => cache.get('rosters', '1', {}, flaky, 1000), /429/);
  assert.equal(cache.size(), 0, 'a failed read leaves no entry');
  const v = await cache.get('rosters', '1', {}, flaky, 1000); // same clock → would be a hit IF it had cached
  assert.equal(v, 'ok', 'the retry actually re-runs the fetcher (failure was not cached)');
  assert.equal(calls, 2);
});

test('clear() drops everything (the write-invalidation hook)', async () => {
  cache.clear();
  let fetches = 0;
  const fetcher = () => { fetches += 1; return Promise.resolve(fetches); };
  await cache.get('rosters', '1', {}, fetcher, 1000);
  cache.clear();
  await cache.get('rosters', '1', {}, fetcher, 1000); // same clock, but cleared → re-fetch
  assert.equal(fetches, 2, 'after clear, the same read re-fetches (post-write freshness)');
});
