'use strict';
// On Deck aggregation & ordering (PO review): draft-on-the-clock pins to the top,
// then timestamped deadlines (lineup locks at next kickoff, scheduled drafts) in
// soonest-first order, then label-only items (waiver runs — MFL gives no run
// timestamp) last. Stubs the sub-services so it tests the aggregation, not MFL.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '5';

const nflLib = require('../../src/lib/nfl');
const draftService = require('../../src/services/draft');
const lineupsService = require('../../src/services/lineups');
const waiversService = require('../../src/services/waivers');

const soon = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(); // +3h (kickoff)
const later = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(); // +5d (draft)

nflLib.nextKickoff = async () => soon;
draftService.getOverview = async () => ({
  drafts: [
    { leagueId: 'A', name: 'League A', status: 'in_progress', myOnClock: true, type: 'Snake draft' },
    { leagueId: 'B', name: 'League B', status: 'scheduled', startTime: later, type: 'Rookie draft' },
  ],
});
lineupsService.getOverview = async () => ({
  leagues: [
    { leagueId: 'C', name: 'League C', status: 'risk' },
    { leagueId: 'D', name: 'League D', status: 'optimal' }, // should be skipped
  ],
});
waiversService.getPending = async () => ({
  pending: [
    { leagueId: 'E', leagueName: 'League E', processTime: 'Wed 3:00 AM' },
    { leagueId: 'E', leagueName: 'League E', processTime: 'Wed 3:00 AM' },
  ],
});

const ondeck = require('../../src/services/ondeck');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const r = await ondeck.getOnDeck('ck', 'tk');
  const types = r.items.map((i) => `${i.type}:${i.leagueId}`);
  console.log('order:', JSON.stringify(types));
  console.log('summary:', JSON.stringify(r.summary));

  // On the clock pins first.
  assert(r.items[0].type === 'draft_clock' && r.items[0].now === true, 'draft clock is first and marked now');
  // Lineup lock (+3h) precedes the scheduled draft (+5d).
  const iLock = types.indexOf('lineup_lock:C');
  const iDraft = types.indexOf('draft_start:B');
  assert(iLock > 0 && iDraft > iLock, 'lineup lock (sooner) sorts before scheduled draft (later)');
  // Optimal league produced no lineup item.
  assert(!types.includes('lineup_lock:D'), 'optimal lineup is not surfaced');
  // Label-only waiver run is last, deduped to one per league, with its label.
  const wr = r.items.find((i) => i.type === 'waiver_run');
  assert(types[types.length - 1] === 'waiver_run:E', 'label-only waiver run sorts last');
  assert(wr.at === null && wr.atLabel === 'Wed 3:00 AM' && /2 pending/.test(wr.detail), 'waiver run is label-only, deduped, counted');
  assert(r.summary.onClock === 1 && r.summary.soonest === soon, 'summary: 1 on clock, soonest = kickoff');

  console.log('✓ On Deck aggregates and orders deadlines correctly');
  console.log('\nON DECK HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
