'use strict';
// Verifies the ADAPTIVE backoff: a 429 from MFL trips a global cooldown so the rest of an
// in-flight burst automatically halves its concurrency and stretches its stagger, then the
// pipe recovers once the window lifts. This is what keeps a cold 15-league fan-out from
// cascading one rate-limit into a wall of them.
//
// Per MFL's Developer Program guidance ("if a request fails, don't retry"), a 429 is NOT
// retried — the request fails fast (callers are fail-soft) while the cooldown protects the
// rest of the burst. This test asserts that contract: fail-fast + trip-and-recover cooldown.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_MAX_CONCURRENT = '4';
process.env.MFL_MIN_REQUEST_INTERVAL_MS = '50'; // penalty window = 8× = 400ms

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mfl = require('../../src/lib/mfl');

// First outbound call rate-limits (Retry-After: 0 → cooldown floors to 8× the min interval),
// every call after that succeeds. We must NOT see a retry of the 429'd call.
let calls = 0;
global.fetch = async () => {
  calls += 1;
  if (calls === 1) {
    return { ok: false, status: 429, headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? '0' : null) }, text: async () => 'rate limited' };
  }
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true }) };
};

(async () => {
  assert(mfl.__throttle.inPenalty() === false, 'starts with no penalty');
  assert(mfl.__throttle.effConcurrent() === 4, 'full concurrency before any rate-limit');

  // One read that 429s. Per MFL guidance we do NOT retry — it fails fast and the caller
  // (fail-soft) handles the rejection. The important effect is the cooldown it trips.
  let threw = false;
  try {
    await mfl.exportRequest('rosters', { host: 'www55.myfantasyleague.com', cookie: 'ck', L: '1' });
  } catch (e) {
    threw = true;
    assert(e.status === 429, 'the rejection carries the 429 status for the caller to see');
  }
  assert(threw, 'a 429 fails fast (no retry) — the request rejects');
  assert(calls === 1, 'the 429 is NOT retried — exactly one outbound call was made');

  // The 429 tripped the cooldown: concurrency is halved and the stagger stretched.
  assert(mfl.__throttle.inPenalty() === true, 'a 429 trips the cooldown window');
  assert(mfl.__throttle.effConcurrent() === 2, 'concurrency halves during the cooldown (4 → 2)');
  assert(mfl.__throttle.effInterval() === 200, 'stagger quadruples during the cooldown (50 → 200)');
  console.log(`✓ 429 fails fast + trips cooldown: concurrency ${mfl.__throttle.effConcurrent()}, interval ${mfl.__throttle.effInterval()}ms`);

  // Recovers after the window (400ms) lifts.
  await sleep(460);
  assert(mfl.__throttle.inPenalty() === false, 'cooldown lifts on its own');
  assert(mfl.__throttle.effConcurrent() === 4, 'full concurrency restored after recovery');
  console.log('✓ cooldown lifts and full throughput returns');

  console.log('\nTHROTTLE BACKOFF HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
