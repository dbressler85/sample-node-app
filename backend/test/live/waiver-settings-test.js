'use strict';
// loadSettings field mapping against the REAL `league` export dictionary (#: waiver-settings pass):
//   • SYSTEM from `currentWaiverType` (BBID*/WAIVERS*/FCFS/None), not undocumented bbid flags — and
//     `None` → 'free' (fixes the old "live never classifies free" limitation).
//   • FAAB floor from `bbidMinimum` (NOT `minBid`, which is the AUCTION minimum), and bids must land
//     on a `bbidIncrement` step.
// Driven through preview() (which resolves settings + validates a bid) so the mapping is observable.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My, Starter', position: 'RB', team: 'AAA' },
  { id: '50', name: 'Free, Agent', position: 'RB', team: 'CCC' },
];
global.fetch = async () => ({ ok: true, json: async () => [] });

// Per-scenario league export the stub returns (set before each preview()).
let leagueDoc = {};
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: 'L1', name: 'Cfg League', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001' }] } };
    case 'league': return { league: leagueDoc };
    case 'rosters': return { rosters: { franchise: [{ id: opts.FRANCHISE || '0001', player: [{ id: '1', status: 'starter' }] }] } };
    case 'freeAgents': return { freeAgents: { leagueUnit: { player: [{ id: '50' }] } } };
    case 'players': return { players: { player: PLAYERS } };
    case 'projectedScores': return { projectedScores: { playerScore: [] } };
    case 'nflSchedule': return { nflSchedule: { week: '3', matchup: [] } };
    case 'calendar': return { calendar: { event: [] } };
    case 'pendingWaivers': return { pendingWaivers: {} };
    case 'playerRosterStatus': return { playerRosterStatuses: { playerStatus: [{ id: '50', is_fa: '1' }] } };
    default: return {};
  }
};
mfl.importRequest = async () => ({ status: 'ok' });

const waivers = require('../../src/services/waivers');
const CK = 'ck', TK = 'tk';
// A generous roster so no drop is required — isolates the bid checks.
const baseFranchise = (extra) => ({ franchises: { franchise: [{ id: '0001', ...extra }] }, starters: { position: [{ name: 'RB', limit: '1' }] }, rosterSize: '40' });

(async () => {
  // 1) BBID league: system faab; floor from bbidMinimum ($2), NOT minBid ($99 auction); $5 increment.
  leagueDoc = { ...baseFranchise({ bbidAvailableBalance: '100' }), currentWaiverType: 'BBID', bbidMinimum: '2', bbidIncrement: '5', minBid: '99' };
  let pv = await waivers.preview(CK, TK, 'L1', { addId: '50', bid: 7 }); // 7-2=5, on the $5 step
  assert(pv.system === 'faab', `currentWaiverType BBID → faab, got ${pv.system}`);
  assert(pv.valid, `bid $7 is legal (floor 2, +$5 step): ${JSON.stringify(pv.errors)}`);
  console.log('✓ BBID → faab; floor=bbidMinimum(2) not minBid(99); $7 legal on the $5 step');

  // Below the bbidMinimum floor → rejected with the $2 minimum (not $1, not the $99 auction min).
  pv = await waivers.preview(CK, TK, 'L1', { addId: '50', bid: 1 });
  assert(!pv.valid && pv.errors.some((e) => /minimum \(\$2\)/.test(e)), `bid $1 below $2 min: ${JSON.stringify(pv.errors)}`);
  console.log('✓ bid below bbidMinimum → "below the minimum ($2)"');

  // Off the increment step ($3: 3-2=1, not a multiple of $5) → rejected with an increment message.
  pv = await waivers.preview(CK, TK, 'L1', { addId: '50', bid: 3 });
  assert(!pv.valid && pv.errors.some((e) => /\$5 increments/.test(e)), `bid $3 off-step: ${JSON.stringify(pv.errors)}`);
  console.log('✓ off-increment bid → "must be in $5 increments"');

  // 2) BBID_FCFS also maps to faab.
  leagueDoc = { ...baseFranchise({ bbidAvailableBalance: '50' }), currentWaiverType: 'BBID_FCFS', bbidMinimum: '1' };
  pv = await waivers.preview(CK, TK, 'L1', { addId: '50', bid: 5 });
  assert(pv.system === 'faab', `BBID_FCFS → faab, got ${pv.system}`);
  console.log('✓ BBID_FCFS → faab');

  // 3) WAIVERS_FCFS → fcfs (priority), no bid required.
  leagueDoc = { ...baseFranchise({ waiverSortOrder: '4' }), currentWaiverType: 'WAIVERS_FCFS' };
  pv = await waivers.preview(CK, TK, 'L1', { addId: '50' });
  assert(pv.system === 'fcfs', `WAIVERS_FCFS → fcfs, got ${pv.system}`);
  console.log('✓ WAIVERS_FCFS → fcfs');

  // 4) None → free (immediate add/drop, no waiver system) — the previously-impossible live case.
  leagueDoc = { ...baseFranchise({}), currentWaiverType: 'None' };
  pv = await waivers.preview(CK, TK, 'L1', { addId: '50' });
  assert(pv.system === 'free', `currentWaiverType None → free, got ${pv.system}`);
  console.log('✓ None → free (fixes the never-free live limitation)');

  // 5) Field absent → fall back to the old heuristic (a bbid flag ⇒ faab) so nothing regresses.
  leagueDoc = { ...baseFranchise({ bbidAvailableBalance: '30' }), bbidWaivers: '1' };
  pv = await waivers.preview(CK, TK, 'L1', { addId: '50', bid: 3 });
  assert(pv.system === 'faab', `no currentWaiverType, bbid flag → faab fallback, got ${pv.system}`);
  console.log('✓ absent currentWaiverType → heuristic fallback (faab)');

  console.log('\nWAIVER SETTINGS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
