'use strict';
// Write priority lane (#4): a user-initiated WRITE (add/drop, waiver claim, lineup submit, trade
// action, and — the deadline-critical one — a live draft pick) must jump ahead of any queued READ,
// so a mutation the user is waiting on can never sit behind a bulk/background read fan-out. Proven
// deterministically with a single slot and manually-resolved fetches, so ordering isn't timing-
// dependent. importRequest (writes) is the path under test — this pins the wiring end-to-end
// (importRequest → HIGH lane), not just the pump primitive.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_MAX_CONCURRENT = '1';
process.env.MFL_MIN_REQUEST_INTERVAL_MS = '0';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const started = []; // order fetches actually fire
const resolvers = {}; // tag -> resolve()
global.fetch = (url) => {
  const tag = String(url).match(/L=([A-Z])/)[1];
  started.push(tag);
  return new Promise((resolve) => {
    resolvers[tag] = () => resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' });
  });
};

const mfl = require('../../src/lib/mfl');
const HOST = 'www10.myfantasyleague.com';
const tick = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  // A (normal READ) takes the only slot and is in-flight. Then enqueue a NORMAL read B, then a
  // WRITE W (importRequest). W queues AFTER B but must run BEFORE it.
  const pA = mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'A' });
  await tick();
  const pB = mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'B' });
  const pW = mfl.importRequest('waivers', { host: HOST, cookie: 'x', L: 'W', TRANSACTION: 'x' });
  await tick();
  assert(started.join('') === 'A', `only A is in-flight while the slot is busy, got ${started.join('')}`);

  // Free the slot. The pump must pick the WRITE W over the earlier-queued READ B.
  resolvers.A(); await pA; await tick();
  assert(started.join('') === 'AW', `write W preempts read B despite B queueing first, got ${started.join('')}`);

  // Free again — now the read B finally runs.
  resolvers.W(); await pW; await tick();
  assert(started.join('') === 'AWB', `read B runs after the write, got ${started.join('')}`);
  resolvers.B(); await pB;

  console.log('✓ user writes preempt queued reads:', started.join(' → '));

  // And the strict lane order HIGH → NORMAL → LOW, at the pump primitive (all three lanes at once).
  const order = [];
  mfl.__throttle._pushLow(() => order.push('low'));
  mfl.__throttle._pushNormal('acct', () => order.push('normal'));
  mfl.__throttle._pushHigh(() => order.push('high'));
  mfl.__throttle._next()(); mfl.__throttle._next()(); mfl.__throttle._next()();
  assert(order.join(',') === 'high,normal,low', `lane order is high→normal→low, got ${order.join(',')}`);
  console.log('✓ lane drain order:', order.join(' → '));

  console.log('\nTHROTTLE WRITE-PRIORITY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
