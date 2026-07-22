'use strict';
// Verifies the ADAPTIVE backoff: a 429 from MFL trips a global cooldown so the rest of an
// in-flight burst automatically halves its concurrency and stretches its stagger, then the
// pipe recovers once the window lifts. This is what keeps a cold 15-league fan-out from
// cascading one rate-limit into a wall of them.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_MAX_CONCURRENT = '4';
process.env.MFL_MIN_REQUEST_INTERVAL_MS = '50'; // penalty window = 8× = 400ms

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mfl = require('../../src/lib/mfl');

// First outbound call rate-limits (Retry-After: 0 → retry immediately, but the cooldown
// still trips), every call after that succeeds.
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

  // One read that 429s then succeeds on retry.
  const r = await mfl.exportRequest('rosters', { host: 'www55.myfantasyleague.com', cookie: 'ck', L: '1' });
  assert(r && r.ok, 'the request recovers after the 429 (retry succeeds)');

  // The 429 tripped the cooldown: concurrency is halved and the stagger stretched.
  assert(mfl.__throttle.inPenalty() === true, 'a 429 trips the cooldown window');
  assert(mfl.__throttle.effConcurrent() === 2, 'concurrency halves during the cooldown (4 → 2)');
  assert(mfl.__throttle.effInterval() === 200, 'stagger quadruples during the cooldown (50 → 200)');
  console.log(`✓ 429 trips cooldown: concurrency ${mfl.__throttle.effConcurrent()}, interval ${mfl.__throttle.effInterval()}ms`);

  // Recovers after the window (400ms) lifts.
  await sleep(460);
  assert(mfl.__throttle.inPenalty() === false, 'cooldown lifts on its own');
  assert(mfl.__throttle.effConcurrent() === 4, 'full concurrency restored after recovery');
  console.log('✓ cooldown lifts and full throughput returns');

  console.log('\nTHROTTLE BACKOFF HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
