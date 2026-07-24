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
const leaguesService = require('../../src/services/leagues');

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
// Live waiver items now resolve each league's next run. E has 2 claims (run time unknown → label
// only, sorts last). F has NO claims but an imminent run (+2d → shown). G has no claims and a far
// run (+10d → excluded).
leaguesService.listLeagues = async () => [
  { leagueId: 'E', name: 'League E' },
  { leagueId: 'F', name: 'League F' },
  { leagueId: 'G', name: 'League G' },
];
const twoDays = Date.now() + 2 * 24 * 60 * 60 * 1000;
const tenDays = Date.now() + 10 * 24 * 60 * 60 * 1000;
waiversService.nextWaiverRun = async (cookie, league) => {
  if (league.leagueId === 'E') return null; // run time unknown → label-only
  if (league.leagueId === 'F') return twoDays; // imminent, no claims
  if (league.leagueId === 'G') return tenDays; // far off, no claims
  return null;
};
const tradesService = require('../../src/services/trades');
tradesService.getOverview = async () => ({
  offers: [{ id: 'o1', leagueId: 'H', leagueName: 'League H', withName: 'Team Rocket', analysis: { verdict: 'favorable' } }],
});
// A manual trade deadline set on league F, ~10 days out → a timed trade_deadline item on On Deck.
// (Exercises the real effectiveDeadline manual-override path.)
const tradeDeadlines = require('../../src/store/tradeDeadlines');
const dl = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
tradeDeadlines.set('tk', 'F', dl);
// League G has NO manual deadline but MFL's calendar carries one (+12d) → auto-surfaced. Stub the
// calendar read so the real effectiveDeadline → nextTradeDeadline chain resolves it (source: mfl).
const mflRepo = require('../../src/lib/mflRepo');
const gDeadlineMs = Date.now() + 12 * 24 * 60 * 60 * 1000;
mflRepo.calendar = async (league) => (league.leagueId === 'G' ? [{ type: 'TRADE_DEADLINE', start_time: Math.floor(gDeadlineMs / 1000) }] : []);

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
  // League E: 2 claims in, run time unknown → label-only (sorts after every timed item), hasClaims.
  const wrE = r.items.find((i) => i.type === 'waiver_run' && i.leagueId === 'E');
  assert(types.indexOf('waiver_run:E') > types.indexOf('draft_start:B'), 'label-only (claims-in) waiver run sorts after timed items');
  assert(wrE.at === null && wrE.atLabel === 'Wed 3:00 AM' && wrE.hasClaims === true && wrE.claimCount === 2 && /2 claims submitted/.test(wrE.detail), 'E waiver run: label-only, deduped, claims counted');
  // League F: no claims but an imminent run (+2d) → shown, timestamped, hasClaims=false.
  const wrF = r.items.find((i) => i.type === 'waiver_run' && i.leagueId === 'F');
  assert(wrF && wrF.hasClaims === false && wrF.claimCount === 0 && wrF.at !== null, 'F waiver run: imminent, no claims, timestamped');
  // League G: no claims and a far run (+10d) → excluded.
  assert(!types.includes('waiver_run:G'), 'far-off claim-free waiver run is not surfaced');
  // Pending trade offers fold into On Deck (untimed → sort after timed items).
  const to = r.items.find((i) => i.type === 'trade_offer');
  assert(to && to.leagueId === 'H' && /Team Rocket/.test(to.label) && to.action === 'trade', 'trade offer folded into On Deck');
  assert(to.at === null && /favorable/.test(to.detail), 'trade offer is untimed with a verdict detail');
  // Action vs upcoming classification: submitted claims (E) are UPCOMING (already acted); a claim-free
  // imminent run (F), trade offers, lineups, drafts-on-clock are ACTIONS. summary.actions counts them.
  assert(to.kind === 'action', 'trade offer is an action');
  assert(wrE.kind === 'upcoming' && /process/i.test(wrE.label), `submitted-claim waiver is upcoming ("Your claims process"), got ${wrE.kind}/${wrE.label}`);
  assert(wrF.kind === 'action', 'a claim-free imminent waiver run is an action');
  assert(r.items.find((i) => i.type === 'draft_clock').kind === 'action', 'draft clock is an action');
  const expectActions = r.items.filter((i) => i.kind === 'action').length;
  assert(r.summary.actions === expectActions && r.summary.upcoming === r.items.filter((i) => i.kind === 'upcoming').length, `summary splits actions/upcoming, got ${JSON.stringify({ a: r.summary.actions, u: r.summary.upcoming })}`);
  // Manual trade deadline on league F → a timed trade_deadline item (source: manual).
  const td = r.items.find((i) => i.type === 'trade_deadline' && i.leagueId === 'F');
  assert(td && td.at !== null && td.action === 'trade' && td.source === 'manual' && /deadline/i.test(td.label), `manual trade deadline surfaced + timed, got ${JSON.stringify(td)}`);
  // League G's deadline comes from MFL's calendar automatically (no manual entry) — source: mfl.
  const tdAuto = r.items.find((i) => i.type === 'trade_deadline' && i.leagueId === 'G');
  assert(tdAuto && tdAuto.at !== null && tdAuto.source === 'mfl', `MFL-calendar trade deadline auto-surfaced, got ${JSON.stringify(tdAuto)}`);
  tradeDeadlines.set('tk', 'F', null); // cleanup so re-runs stay deterministic
  assert(r.summary.onClock === 1 && r.summary.soonest === soon, 'summary: 1 on clock, soonest = kickoff');

  console.log('✓ On Deck aggregates and orders deadlines correctly');
  console.log('\nON DECK HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
