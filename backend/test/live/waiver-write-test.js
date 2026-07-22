'use strict';
// LIVE write-path correctness for the MFL Import API (docs/MFL_API_AUDIT.md §2). Pins the
// exact import TYPE + params so the earlier scrambled mapping can't come back:
//   FAAB claim  -> blindBidWaiverRequest, PICKS="add_bid_drop" (0000 = no drop), no ROUND.
//   FCFS claim  -> 501 (we can't source the waiver ROUND yet — honest error, no MFL write).
//   plain drop  -> fcfsWaiver with only DROP (there is no standalone `drop` TYPE).
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My, Starter', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My, Bench', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free, Agent', position: 'RB', team: 'CCC' },
];
global.fetch = async () => ({ ok: true, json: async () => [] }); // enrichment providers empty

// Two leagues: LFAAB (blind bid) and LFCFS (first-come priority). The `league` export branches
// on opts.L so each resolves to a different pickup system.
function leagueExport(L) {
  const faab = L === 'LFAAB';
  return { league: {
    rosterSize: '3', minBid: '1', // 2 rostered → one open spot, so a no-drop add needs no drop

    ...(faab ? { bbidWaivers: '1' } : {}),
    franchises: { franchise: [{ id: '0001', name: 'Me', ...(faab ? { bbidAvailableBalance: '80' } : { waiverSortOrder: '2' }) }] },
    starters: { position: [{ name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] },
  } };
}
function baseExport(type, opts = {}) {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [
        { league_id: 'LFAAB', name: 'FAAB League', url: 'https://www10.myfantasyleague.com/2026/home/LFAAB', franchise_id: '0001', franchise_name: 'Me' },
        { league_id: 'LFCFS', name: 'FCFS League', url: 'https://www11.myfantasyleague.com/2026/home/LFCFS', franchise_id: '0001', franchise_name: 'Me' },
      ] } };
    case 'league':
      return leagueExport(String(opts.L));
    case 'rosters':
      return { rosters: { franchise: [{ id: opts.FRANCHISE || '0001', player: [{ id: '1', status: 'starter' }, { id: '2', status: 'nonstarter' }] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '50' }] } } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'projectedScores':
      return { projectedScores: { playerScore: [{ id: '50', score: '12' }] } };
    case 'nflSchedule':
      return { nflSchedule: { week: '3', matchup: [{ team: [{ id: 'CCC' }, { id: 'ZZZ' }] }] } };
    default:
      return {};
  }
}
mfl.exportRequest = async (type, opts) => baseExport(type, opts);

let imports = [];
mfl.importRequest = async (type, params) => { imports.push({ type, params }); return { status: 'ok' }; };

const waivers = require('../../src/services/waivers');
const playerhub = require('../../src/services/playerhub');
const CK = 'ck', TK = 'tk';

(async () => {
  // 1) FAAB claim → blindBidWaiverRequest with PICKS "add_bid_drop".
  const okFaab = await waivers.preview(CK, TK, 'LFAAB', { addId: '50', dropId: '2', bid: 5 });
  assert(okFaab.valid, `FAAB claim previews valid: ${okFaab.errors.join('; ')}`);
  await waivers.submit(CK, TK, 'LFAAB', { addId: '50', dropId: '2', bid: 5 });
  const bb = imports.find((i) => i.type === 'blindBidWaiverRequest');
  assert(bb, `FAAB submit uses blindBidWaiverRequest (not the bogus blindBidWaiver), got ${JSON.stringify(imports.map((i) => i.type))}`);
  assert(bb.params.PICKS === '50_5_2', `PICKS is add_bid_drop, got ${bb.params.PICKS}`);
  assert(bb.params.ROUND === undefined, 'no ROUND for standard blind bidding');
  assert(bb.params.ADD === undefined && bb.params.BID === undefined, 'no stray ADD/BID params');
  console.log('✓ FAAB: blindBidWaiverRequest PICKS=50_5_2 (add_bid_drop)');

  // FAAB with no drop → 0000 sentinel in the drop slot.
  imports = [];
  await waivers.submit(CK, TK, 'LFAAB', { addId: '50', bid: 7 });
  const bb2 = imports.find((i) => i.type === 'blindBidWaiverRequest');
  assert(bb2 && bb2.params.PICKS === '50_7_0000', `no-drop bid uses 0000 sentinel, got ${bb2 && bb2.params.PICKS}`);
  console.log('✓ FAAB no-drop: PICKS=50_7_0000');

  // 2) FCFS claim → honest 501, and NO import is sent to MFL.
  imports = [];
  let threw = false;
  try {
    await waivers.submit(CK, TK, 'LFCFS', { addId: '50', dropId: '2' });
  } catch (e) {
    threw = true;
    assert(e.status === 501, `FCFS submit returns 501, got ${e.status}`);
    assert(/first-come|MyFantasyLeague/i.test(e.message), 'FCFS error points to MFL');
  }
  assert(threw, 'FCFS submit fails fast instead of misfiling a claim');
  assert(imports.length === 0, 'no MFL write on the unsupported FCFS path');
  console.log('✓ FCFS: 501, no MFL write');

  // 3) Plain drop → fcfsWaiver with only DROP (no standalone `drop` TYPE).
  imports = [];
  const res = await playerhub.submitDrop(CK, TK, '2', ['LFAAB']);
  assert(res.results.some((r) => r.leagueId === 'LFAAB' && r.ok), `drop succeeded: ${JSON.stringify(res.results)}`);
  const fc = imports.find((i) => i.type === 'fcfsWaiver');
  assert(fc, `drop uses fcfsWaiver (not the non-existent 'drop'), got ${JSON.stringify(imports.map((i) => i.type))}`);
  assert(String(fc.params.DROP) === '2' && fc.params.ADD === undefined, `fcfsWaiver drops 2 with no ADD, got ${JSON.stringify(fc.params)}`);
  assert(!imports.some((i) => i.type === 'drop'), "the phantom 'drop' TYPE is never sent");
  console.log('✓ drop: fcfsWaiver DROP=2, no ADD');

  console.log('\nWAIVER WRITE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
