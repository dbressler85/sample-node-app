'use strict';
// Covers the request-collapsing primitives behind the roster / free-agent read
// caches: the promise-coalescing TTL memo (lib/memo) and the MFL client's
// concurrent-read coalescing + per-league invalidation (lib/mfl).
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_MIN_REQUEST_INTERVAL_MS = '0'; // no throttle delay in the harness

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // --- lib/memo: coalescing, invalidation, TTL, error-not-cached ---------------
  const { createMemo } = require('../../src/lib/memo');
  const memo = createMemo({ ttlMs: 50 });

  let produced = 0;
  const make = async () => { produced += 1; await sleep(10); return produced; };

  // Two concurrent gets for the same key share ONE produce.
  const [a, b] = await Promise.all([memo.get('k', make), memo.get('k', make)]);
  assert(produced === 1, `concurrent gets coalesce to one produce, got ${produced}`);
  assert(a === 1 && b === 1, 'both callers get the same result');

  // A repeat within TTL is served from cache (still one produce).
  await memo.get('k', make);
  assert(produced === 1, `within-TTL repeat is cached, got ${produced}`);

  // Invalidate forces a rebuild.
  memo.invalidate('k');
  await memo.get('k', make);
  assert(produced === 2, `invalidate forces a fresh produce, got ${produced}`);

  // TTL expiry forces a rebuild.
  await sleep(60);
  await memo.get('k', make);
  assert(produced === 3, `expired entry rebuilds, got ${produced}`);

  // A rejected produce is NOT cached — the next call retries.
  const memo2 = createMemo({ ttlMs: 1000 });
  let tries = 0;
  const flaky = async () => { tries += 1; if (tries === 1) throw new Error('boom'); return 'ok'; };
  let threw = false;
  try { await memo2.get('x', flaky); } catch (e) { threw = true; }
  assert(threw, 'first get rejects');
  const second = await memo2.get('x', flaky);
  assert(second === 'ok' && tries === 2, `error not cached — retried, tries=${tries}`);
  console.log('✓ memo: concurrent gets coalesce; invalidate + TTL rebuild; errors not cached');

  // --- lib/mfl: concurrent export coalescing + per-league invalidation ---------
  const mfl = require('../../src/lib/mfl');
  let fetches = 0;
  global.fetch = async () => {
    fetches += 1;
    await sleep(10);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ rosters: { franchise: [] } }) };
  };

  const CK = 'ck';
  const opts = { host: 'www10.myfantasyleague.com', cookie: CK, L: '100' };
  // Two concurrent identical reads -> one network fetch.
  await Promise.all([mfl.exportRequest('rosters', opts), mfl.exportRequest('rosters', opts)]);
  assert(fetches === 1, `concurrent identical reads coalesce to one fetch, got ${fetches}`);
  // A repeat within TTL is cached.
  await mfl.exportRequest('rosters', opts);
  assert(fetches === 1, `within-TTL repeat is cached, got ${fetches}`);
  // A different league is a separate read.
  await mfl.exportRequest('rosters', { ...opts, L: '200' });
  assert(fetches === 2, `distinct league fetches separately, got ${fetches}`);
  // Invalidate league 100 -> its next read hits the network again; 200 stays cached.
  mfl.invalidateLeague(CK, '100');
  await mfl.exportRequest('rosters', { ...opts, L: '200' });
  assert(fetches === 2, `unrelated league still cached after invalidate, got ${fetches}`);
  await mfl.exportRequest('rosters', opts);
  assert(fetches === 3, `invalidated league re-fetches, got ${fetches}`);
  console.log('✓ mfl: concurrent reads coalesce; invalidateLeague drops only that league');

  console.log('\nCACHE PRIMITIVES HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
