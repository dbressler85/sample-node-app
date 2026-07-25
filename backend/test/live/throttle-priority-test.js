'use strict';
// Priority lanes (#2): background/bulk work (the Sunday pre-warm, the daily player-DB refresh) runs
// at LOW priority and must never delay a NORMAL (user-facing) request — even a normal request that
// was enqueued AFTER the low one jumps ahead. Proven deterministically with a single slot and
// manually-resolved fetches, so ordering isn't timing-dependent.
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
  // A (normal) takes the only slot and is in-flight. Then enqueue LOW=B, then NORMAL=C.
  const pA = mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'A' });
  await tick();
  const pB = mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'B', priority: 'low' });
  const pC = mfl.exportRequest('rosters', { host: HOST, cookie: 'x', L: 'C' });
  await tick();
  assert(started.join('') === 'A', `only A is in-flight while the slot is busy, got ${started.join('')}`);

  // Free the slot. The pump must pick the NORMAL C over the earlier-queued LOW B.
  resolvers.A(); await pA; await tick();
  assert(started.join('') === 'AC', `normal C runs before low B despite B queueing first, got ${started.join('')}`);

  // Free again — now the low-priority B finally runs.
  resolvers.C(); await pC; await tick();
  assert(started.join('') === 'ACB', `low B runs last, got ${started.join('')}`);
  resolvers.B(); await pB;

  console.log('✓ low-priority (background) work yields to normal user reads:', started.join(' → '));
  console.log('\nTHROTTLE PRIORITY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
