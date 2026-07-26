'use strict';
// Unit test for lib/retry.withRetry — the shared transient-throttle retry used by the cross-league
// fan-outs (draft/trades/waivers/portfolio) so one rate-limited read doesn't get swallowed into a
// misleading "nothing here." Uses a 1ms base delay to stay fast.
const { withRetry } = require('../../src/lib/retry');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // 1) succeeds on the first try — called exactly once.
  let calls = 0;
  const a = await withRetry(async () => { calls += 1; return 'ok'; }, 3, 1);
  assert(a === 'ok' && calls === 1, `first-try success calls once, got ${calls}`);

  // 2) fails twice (transient), then succeeds — returns the value after retrying.
  calls = 0;
  const b = await withRetry(async () => { calls += 1; if (calls < 3) throw new Error('429'); return 'recovered'; }, 3, 1);
  assert(b === 'recovered' && calls === 3, `retries until success, got ${calls} calls`);

  // 3) always fails — throws the last error after exhausting attempts.
  calls = 0;
  let threw = null;
  try {
    await withRetry(async () => { calls += 1; throw new Error(`boom ${calls}`); }, 3, 1);
  } catch (e) { threw = e; }
  assert(threw && /boom 3/.test(threw.message) && calls === 3, `exhausts then throws the last error, got ${calls} calls / ${threw && threw.message}`);

  console.log('✓ withRetry: once on success, retries transient failures, throws after exhausting');
  console.log('\nRETRY HELPER PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
