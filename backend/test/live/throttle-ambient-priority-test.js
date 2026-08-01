'use strict';
// Ambient request priority (Fix A): a read fired WITHOUT an explicit priority, but from inside a
// low-priority request context (reqPriority.runLow — what the priority middleware wraps a request in
// when the client sends X-DC-Priority: low), must inherit LOW and yield to a normal user read. This is
// what lets the mobile Home warm / idle prefetch run in the background lane without threading a
// priority param through every service → mflRepo → exportRequest call. Driven deterministically with a
// single slot and manually-resolved fetches so ordering isn't timing-dependent.
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
const reqPriority = require('../../src/lib/reqPriority');
const HOST = 'www10.myfantasyleague.com';
const tick = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  // A (normal) takes the only slot and is in-flight. Then enqueue B from WITHIN a runLow() context but
  // with NO explicit priority (it must inherit LOW), then a plain NORMAL C.
  const pA = mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'A' });
  await tick();
  const pB = reqPriority.runLow(() => mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'B' }));
  const pC = mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'C' });
  await tick();
  assert(started.join('') === 'A', `only A is in-flight while the slot is busy, got ${started.join('')}`);

  // Free the slot. If B inherited LOW from the ambient context, the pump picks NORMAL C over it even
  // though B queued first — exactly the background-yields-to-foreground behavior Fix A relies on.
  resolvers.A(); await pA; await tick();
  assert(started.join('') === 'AC', `ambient-low B yields to normal C despite queueing first, got ${started.join('')}`);

  resolvers.C(); await pC; await tick();
  assert(started.join('') === 'ACB', `ambient-low B runs last, got ${started.join('')}`);
  resolvers.B(); await pB;
  console.log('✓ a no-explicit-priority read inside runLow() inherits LOW and yields to a user read:', started.join(' → '));

  // An EXPLICIT priority still wins over the ambient context: a read that passes priority:'normal' from
  // inside runLow() stays NORMAL. D (explicit normal, inside runLow) takes the slot; E (ambient low)
  // then queues behind a later plain-normal F.
  started.length = 0;
  const pD = reqPriority.runLow(() => mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'D', priority: 'normal' }));
  await tick();
  assert(started.join('') === 'D', `explicit-normal D runs immediately despite the low ambient context, got ${started.join('')}`);
  const pE = reqPriority.runLow(() => mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'E' })); // ambient low
  const pF = mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'F' }); // plain normal
  await tick();
  resolvers.D(); await pD; await tick();
  assert(started.join('') === 'DF', `explicit priority overrides ambient: normal F precedes ambient-low E, got ${started.join('')}`);
  resolvers.F(); await pF; await tick();
  resolvers.E(); await pE;
  console.log('✓ an explicit priority still overrides the ambient context:', started.join(' → '));

  console.log('\nAMBIENT PRIORITY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
