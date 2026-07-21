'use strict';
// Per-IP failed-login throttle (PO review Step 3). /api/auth/login proxies whatever
// credentials it's given straight to MFL, so repeated failures from one source IP
// must lock out. A success clears the streak; the window expires; IPs are isolated.
process.env.MFL_DEMO_MODE = 'true';

const config = require('../../src/config');
const guard = require('../../src/lib/loginGuard');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  guard._clear();
  const MAX = config.loginMaxFails;
  const IP = '1.2.3.4';
  const t0 = 1000000; // fixed clock so the test doesn't depend on wall time

  assert(!guard.check(IP, t0).blocked, 'a fresh IP is not blocked');
  for (let i = 0; i < MAX - 1; i++) guard.fail(IP, t0);
  assert(!guard.check(IP, t0).blocked, `under the limit (${MAX - 1} fails) is still allowed`);
  guard.fail(IP, t0); // reaches MAX
  const g = guard.check(IP, t0);
  assert(g.blocked, `hitting ${MAX} failures locks the IP out`);
  assert(g.retryAfter > 0 && g.retryAfter <= Math.ceil(config.loginFailWindowMs / 1000), 'retryAfter is within the window');
  console.log(`✓ locks out after ${MAX} failed attempts (retry in ${g.retryAfter}s)`);

  guard.succeed(IP);
  assert(!guard.check(IP, t0).blocked, 'a successful login clears the lockout');
  console.log('✓ a successful login clears the failure streak');

  for (let i = 0; i < MAX; i++) guard.fail(IP, t0);
  assert(guard.check(IP, t0).blocked, 'blocked within the window');
  const later = t0 + config.loginFailWindowMs + 1;
  assert(!guard.check(IP, later).blocked, 'the lockout expires after the window');
  console.log('✓ lockout expires after the window');

  guard._clear();
  for (let i = 0; i < MAX; i++) guard.fail('9.9.9.9', t0);
  assert(guard.check('9.9.9.9', t0).blocked, 'the offending IP is blocked');
  assert(!guard.check('5.5.5.5', t0).blocked, 'an unrelated IP is unaffected');
  console.log('✓ throttle is per-IP');

  console.log('\nLOGIN GUARD HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
