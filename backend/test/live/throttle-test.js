'use strict';
// Verifies the MFL client runs requests with BOUNDED CONCURRENCY (not strict
// serialization). Regression guard for the first-launch latency fix: cold-cache
// fan-outs must overlap, while never exceeding the configured concurrency cap.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_MAX_CONCURRENT = '3';
process.env.MFL_MIN_REQUEST_INTERVAL_MS = '0'; // isolate the concurrency cap from the stagger

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mfl = require('../../src/lib/mfl');

let inFlight = 0;
let maxSeen = 0;
let started = 0;
global.fetch = async () => {
  inFlight += 1;
  started += 1;
  maxSeen = Math.max(maxSeen, inFlight);
  await sleep(25);
  inFlight -= 1;
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true }) };
};

(async () => {
  // 12 DISTINCT reads (different L) so nothing coalesces or hits the cache.
  const reqs = [];
  for (let i = 0; i < 12; i += 1) reqs.push(mfl.exportRequest('rosters', { host: 'www55.myfantasyleague.com', cookie: 'ck', L: String(i) }));
  await Promise.all(reqs);

  assert(started === 12, `all 12 requests ran, got ${started}`);
  assert(maxSeen <= 3, `never exceeds the concurrency cap of 3, saw ${maxSeen}`);
  assert(maxSeen >= 2, `runs concurrently, not serially (old behavior would be 1), saw ${maxSeen}`);
  console.log(`✓ throttle: 12 reads, peak concurrency ${maxSeen} (cap 3) — concurrent, capped`);

  console.log('\nTHROTTLE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
