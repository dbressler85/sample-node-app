'use strict';
// mapLeagues() is the fan-out form of safeCall: run fn per league concurrently, isolate each
// league's failure (log it, substitute a fallback) so one league's hiccup never fails the whole
// cross-league aggregate. Pins order-preservation, per-league isolation, the value/function
// fallback forms, sync-throw capture, and that a failure is logged (not silently swallowed).
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const { mapLeagues } = require('../../src/lib/safe');

// Capture logDegrade's console.warn so the harness stays quiet AND we can prove a failure logged.
const warned = [];
const origWarn = console.warn;
console.warn = (msg) => { warned.push(String(msg)); };

(async () => {
  const leagues = [{ leagueId: 'A' }, { leagueId: 'B' }, { leagueId: 'C' }];

  // 1) Happy path: results align to input order, fn sees (league, index).
  const idxSeen = [];
  const ok = await mapLeagues(leagues, (l, i) => { idxSeen.push(i); return `${l.leagueId}:${i}`; });
  assert(ok.join(',') === 'A:0,B:1,C:2', 'results preserve input order and expose index');
  assert(idxSeen.slice().sort().join('') === '012', 'fn is called once per league');

  // 2) Per-league isolation with a static fallback: B rejects, A/C still resolve.
  const iso = await mapLeagues(
    leagues,
    (l) => (l.leagueId === 'B' ? Promise.reject(new Error('boom B')) : Promise.resolve(l.leagueId)),
    null,
    'test.iso'
  );
  assert(iso[0] === 'A' && iso[1] === null && iso[2] === 'C', 'a rejecting league yields the fallback; neighbors survive');
  assert(warned.some((w) => /test\.iso league=B/.test(w)), 'the failing league is logged, not silently swallowed');

  // 3) Function fallback receives (league, index) — for a league-specific default like [id, null].
  const fb = await mapLeagues(
    leagues,
    (l) => (l.leagueId === 'C' ? Promise.reject(new Error('boom C')) : [l.leagueId, 'ok']),
    (l) => [l.leagueId, null],
    'test.fbfn'
  );
  assert(JSON.stringify(fb[2]) === JSON.stringify(['C', null]), 'function fallback builds a league-specific default');
  assert(JSON.stringify(fb[0]) === JSON.stringify(['A', 'ok']), 'non-failing league keeps its real value');

  // 4) A synchronous throw inside fn is caught just like a rejection.
  const sync = await mapLeagues(leagues, (l) => { if (l.leagueId === 'A') throw new Error('sync'); return l.leagueId; }, 'FB', 'test.sync');
  assert(sync[0] === 'FB' && sync[1] === 'B', 'a synchronous throw in fn degrades to fallback');

  // 5) Empty / absent input → [] (no throw).
  assert((await mapLeagues([], () => 1)).length === 0, 'empty leagues → []');
  assert((await mapLeagues(undefined, () => 1)).length === 0, 'undefined leagues → []');

  console.warn = origWarn;
  console.log('✓ mapLeagues: order, per-league isolation, value/function fallback, sync-throw, empty input');
  console.log('\nMAP-LEAGUES HARNESS PASSED');
})().catch((e) => { console.warn = origWarn; console.error(e.message); process.exit(1); });
