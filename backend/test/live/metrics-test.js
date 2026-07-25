'use strict';
// Observability: the metrics layer counts MFL fetches vs cache hits (and shared-vs-private hits), and
// exportRequest/rawRequest feed it — so /_metrics can show the caching working. Also checks the
// throttle + warm stat accessors the endpoint composes.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_MAX_CONCURRENT = '4';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

let fetches = 0;
global.fetch = async () => { fetches += 1; return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' }; };

const metrics = require('../../src/lib/metrics');
const mfl = require('../../src/lib/mfl');
const warm = require('../../src/services/warm');
const HOST = 'www10.myfantasyleague.com';

(async () => {
  // 1) Snapshot math from direct records.
  metrics._reset();
  metrics.recordMiss(); metrics.recordFetch('rosters');
  metrics.recordHit(true); metrics.recordHit(true); metrics.recordHit(false); // 2 shared, 1 private
  metrics.record429();
  const s = metrics.snapshot();
  assert(s.cacheHits === 3 && s.cacheMisses === 1, `hits/misses counted, got ${s.cacheHits}/${s.cacheMisses}`);
  assert(s.hitRatePct === 75, `hit rate = 3/(3+1) = 75%, got ${s.hitRatePct}`);
  assert(s.sharedHits === 2 && s.privateHits === 1, 'shared vs private hits split');
  assert(s.sharedHitPct === 66.7, `shared-hit share ≈ 2/3, got ${s.sharedHitPct}`);
  assert(s.http429 === 1 && s.fetches === 1, '429 + fetch counted');
  assert(s.topTypes.some((t) => t.type === 'rosters' && t.fetches === 1), 'per-type fetch breakdown present');
  console.log(`✓ snapshot: hitRate ${s.hitRatePct}%, shared-hit ${s.sharedHitPct}%, 429s ${s.http429}`);

  // 2) exportRequest feeds it: a SHARED read fetched by A, hit by B (cross-user), counted as shared.
  metrics._reset();
  await mfl.exportRequest('rosters', { host: HOST, cookie: 'A', L: 'MX1' }); // miss → fetch
  await mfl.exportRequest('rosters', { host: HOST, cookie: 'B', L: 'MX1' }); // shared HIT (no fetch)
  let m = metrics.snapshot();
  assert(m.cacheMisses === 1 && m.fetches === 1, `one MFL fetch for two members, got misses=${m.cacheMisses} fetches=${m.fetches}`);
  assert(m.sharedHits === 1, `the second member's read was a shared cache hit, got ${m.sharedHits}`);

  // A PRIVATE read (myleagues) hit by the same cookie counts as a private hit.
  await mfl.exportRequest('myleagues', { host: HOST, cookie: 'A' }); // miss → fetch
  await mfl.exportRequest('myleagues', { host: HOST, cookie: 'A' }); // private HIT
  m = metrics.snapshot();
  assert(m.privateHits === 1, `a repeat private read is a private hit, got ${m.privateHits}`);
  console.log(`✓ exportRequest instrumented: ${m.fetches} fetches, ${m.sharedHits} shared + ${m.privateHits} private hits`);

  // 3) The accessors the /_metrics route composes.
  const t = mfl.throttleStats();
  assert('active' in t && 'queuedNormal' in t && 'queuedLow' in t && 'cacheSize' in t, `throttleStats shape, got ${JSON.stringify(Object.keys(t))}`);
  assert(t.cacheSize > 0, 'read cache has entries after the reads above');
  const w = warm.stats();
  assert(typeof w.enabled === 'boolean' && typeof w.inWindow === 'boolean', 'warm.stats exposes enabled + inWindow');
  console.log(`✓ endpoint accessors: throttle cacheSize=${t.cacheSize}, warm enabled=${w.enabled}`);

  console.log('\nMETRICS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
