'use strict';
// Per-account fair queue (architecture #12): the NORMAL throttle lane round-robins across accounts so
// one account's big cold fan-out (a 15-league sweep = dozens of queued reads) can't park ahead of
// another account's single interactive tap. Global concurrency/stagger/penalty are unchanged — this
// is latency isolation, not extra quota. We drive the scheduler primitives directly (deterministic,
// no timers/network) and assert the drain order.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const t = mfl.__throttle;

// Drain everything the scheduler hands out, in order.
function drainAll() {
  const out = [];
  for (let r = t._next(); r != null; r = t._next()) out.push(r);
  return out;
}

// 1) Round-robin fairness: account A enqueues 3, account B enqueues 1 (after A). B must NOT wait
//    behind all of A — it's served on the very next round (2nd overall), not last.
t._pushNormal('A', 'A1');
t._pushNormal('A', 'A2');
t._pushNormal('A', 'A3');
t._pushNormal('B', 'B1');
assert(t._pending() === 4, `4 queued, got ${t._pending()}`);
assert(t._accounts() === 2, `2 distinct accounts queued, got ${t._accounts()}`);
const order = drainAll();
assert(order.join(',') === 'A1,B1,A2,A3', `round-robin drain order, got ${order.join(',')}`);
assert(t._pending() === 0 && t._accounts() === 0, 'queue fully drained');
console.log('✓ round-robin: B (1 request) is served 2nd, not stuck behind all of A —', order.join(' '));

// 2) FIFO WITHIN an account is preserved (A1 before A2 before A3 above); confirm with a fresh single
//    account too.
t._pushNormal('X', 'X1');
t._pushNormal('X', 'X2');
assert(drainAll().join(',') === 'X1,X2', 'single account keeps FIFO order');
console.log('✓ FIFO preserved within one account');

// 3) NORMAL fully before LOW: a low-priority (background/warm) item waits until every normal item has
//    drained, so a user request is never delayed by the pre-warm loop.
t._pushLow('LOW1');
t._pushNormal('A', 'N1');
t._pushNormal('B', 'N2');
const mixed = drainAll();
assert(mixed.join(',') === 'N1,N2,LOW1', `normal drains before low, got ${mixed.join(',')}`);
console.log('✓ NORMAL lane fully precedes LOW (background never delays a user read)');

console.log('\nTHROTTLE FAIR-QUEUE HARNESS PASSED');
