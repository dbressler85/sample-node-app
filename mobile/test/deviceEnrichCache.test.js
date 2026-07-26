'use strict';

// Unit tests for the U-4 enrichment resilience cache (src/deviceEnrichCache.js): cache-through that always
// tries the backend, remembers the last success, and serves it tagged `_stale` when the backend is
// unreachable — so device-origin Shape-A reads keep working during a backend outage. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const cache = require('../src/deviceEnrichCache');

test('cache-through: always returns fresh from the backend, and remembers it', async () => {
  cache.clear();
  let calls = 0;
  const fetcher = async () => { calls += 1; return { players: { 10: { name: 'Fresh' } } }; };
  const a = await cache.players('L1', fetcher);
  const b = await cache.players('L1', fetcher);
  assert.equal(a.players[10].name, 'Fresh');
  assert.equal(calls, 2, 'the backend is hit every time when it succeeds (not a freshness cache)');
  assert.equal(a._stale, undefined, 'a fresh value is not marked stale');
  assert.equal(b._stale, undefined);
});

test('serves the last-known value tagged _stale when the backend fails (U-4)', async () => {
  cache.clear();
  const good = { franchises: { '0001': 'Team One' }, name: 'League A' };
  await cache.directory('L1', async () => good); // prime
  const out = await cache.directory('L1', async () => { throw new Error('Network request failed'); });
  assert.equal(out.name, 'League A', 'the last-known directory is served during the outage');
  assert.deepEqual(out.franchises, good.franchises);
  assert.equal(out._stale, true, 'the served value is flagged stale so the read can mark itself _offline');
});

test('rethrows when the backend fails and nothing was ever cached (can\'t conjure data)', async () => {
  cache.clear();
  await assert.rejects(
    () => cache.players('never-seen', async () => { throw new Error('boom'); }),
    /boom/,
  );
});

test('keys are independent per league + per kind', async () => {
  cache.clear();
  await cache.directory('L1', async () => ({ name: 'A' }));
  await cache.directory('L2', async () => ({ name: 'B' }));
  const l1 = await cache.directory('L1', async () => { throw new Error('down'); });
  const l2 = await cache.directory('L2', async () => { throw new Error('down'); });
  assert.equal(l1.name, 'A');
  assert.equal(l2.name, 'B');
  // A different kind (players) for the same league is a separate entry.
  await assert.rejects(() => cache.players('L1', async () => { throw new Error('down'); }), /down/);
});

test('clear() wipes everything (logout / C11)', async () => {
  cache.clear();
  await cache.directory('L1', async () => ({ name: 'A' }));
  assert.ok(cache.size() >= 1);
  cache.clear();
  assert.equal(cache.size(), 0);
  await assert.rejects(() => cache.directory('L1', async () => { throw new Error('down'); }), /down/, 'after clear, nothing is served stale');
});
