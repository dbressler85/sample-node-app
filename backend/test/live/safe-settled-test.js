'use strict';
// mapLeaguesSettled + partiality (#12): the shared partial-load envelope every cross-league fan-out
// uses to compute leaguesLoaded/partial the same way. The distinction under test is the one a plain
// mapLeagues + .filter(Boolean) can't make: a league that FAILED (threw) vs. one that loaded fine and
// is simply EMPTY (offseason board, inbox with no offers). Only the former counts against `partial`.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const { mapLeaguesSettled, partiality } = require('../../src/lib/safe');

(async () => {
  const leagues = [
    { leagueId: 'L1', name: 'has data' },
    { leagueId: 'L2', name: 'empty but ok' },
    { leagueId: 'L3', name: 'throttled' },
  ];

  const settled = await mapLeaguesSettled(leagues, async (l) => {
    if (l.leagueId === 'L2') return null; // loaded fine, nothing live (offseason / bye)
    if (l.leagueId === 'L3') throw new Error('MFL 429'); // genuine failure
    return { card: 'L1' };
  }, 'test.fanout');

  // Envelope shape: ok true/false, value carried, error only on failure.
  assert(settled.length === 3, `one envelope per league, got ${settled.length}`);
  const byId = Object.fromEntries(settled.map((s) => [s.leagueId, s]));
  assert(byId.L1.ok === true && byId.L1.value && byId.L1.value.card === 'L1', 'L1 ok with value');
  assert(byId.L2.ok === true && byId.L2.value === null && byId.L2.error === null, 'L2 ok but empty (NOT a failure)');
  assert(byId.L3.ok === false && byId.L3.error instanceof Error, 'L3 marked failed with its error');
  console.log('✓ envelope distinguishes ok+value, ok+empty, and failed');

  // partiality counts leagues we could READ (L1 + L2), not leagues with data — L2 being empty is not a
  // partial load, only L3's throw is.
  const p = partiality(settled);
  assert(p.leagueCount === 3, `leagueCount is the true total, got ${p.leagueCount}`);
  assert(p.leaguesLoaded === 2, `leaguesLoaded counts ok reads incl. empty, got ${p.leaguesLoaded}`);
  assert(p.partial === true, 'partial is set because L3 genuinely failed');
  console.log(`✓ partiality: ${p.leaguesLoaded}/${p.leagueCount} loaded, partial=${p.partial}`);

  // The false-partial guard: an all-empty fan-out (every league loaded, none has live data — a typical
  // offseason scoreboard) must NOT report partial. This is the bug the envelope fixes vs. the old
  // `raw.length - cards.length` count.
  const offseason = await mapLeaguesSettled(leagues, async () => null, 'test.offseason');
  const op = partiality(offseason);
  assert(op.partial === false && op.leaguesLoaded === 3, `all-empty is NOT partial, got partial=${op.partial} loaded=${op.leaguesLoaded}`);
  console.log('✓ an all-empty (offseason) fan-out reports partial=false, not a false "some failed"');

  // A total wipeout (every league threw) is fully partial with zero loaded.
  const wiped = await mapLeaguesSettled(leagues, async () => { throw new Error('MFL 429'); }, 'test.wiped');
  const wp = partiality(wiped);
  assert(wp.partial === true && wp.leaguesLoaded === 0, `all-failed → partial with 0 loaded, got partial=${wp.partial} loaded=${wp.leaguesLoaded}`);
  console.log('✓ an all-failed fan-out reports partial=true with 0 loaded');

  console.log('\nSAFE SETTLED-ENVELOPE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
