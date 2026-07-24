'use strict';
// LIVE cancel-path correctness (#93). MFL has no "delete one waiver claim" call — a queued pick is
// canceled by RESUBMITTING its whole round with REPLACE and every OTHER pick preserved (empty PICKS
// clears the round). Before this fix, cancel() only did a local store.remove, so an MFL-sourced claim
// (id "mfl-<system>-<round>-<idx>") 404'd AND the real bid still processed. This pins:
//   • FAAB cancel of one pick in a 2-pick round → blindBidWaiverRequest, REPLACE=1, PICKS = the OTHER
//     pick (in add_bid_drop form), same ROUND. Claims placed outside the app survive.
//   • FCFS cancel of the LAST pick in a round → waiverRequest, REPLACE=1, empty PICKS (clears round).
//   • Demo still store-only (no MFL write).
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My, Starter', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My, Bench', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free, Agent', position: 'RB', team: 'CCC' },
  { id: '51', name: 'Other, Guy', position: 'WR', team: 'DDD' },
];
global.fetch = async () => ({ ok: true, json: async () => [] });

const past = String(Math.floor(Date.now() / 1000) - 86400);
const state = { calendar: { event: [] }, pending: {}, transactions: { transaction: [] } };

function leagueExport(L) {
  const faab = L === 'LFAAB';
  return { league: {
    rosterSize: '3', minBid: '1',
    ...(faab ? { bbidWaivers: '1' } : {}),
    franchises: { franchise: [{ id: '0001', name: 'Me', ...(faab ? { bbidAvailableBalance: '80' } : { waiverSortOrder: '2' }) }] },
    starters: { position: [{ name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] },
  } };
}
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [
        { league_id: 'LFAAB', name: 'FAAB League', url: 'https://www10.myfantasyleague.com/2026/home/LFAAB', franchise_id: '0001', franchise_name: 'Me' },
        { league_id: 'LFCFS', name: 'FCFS League', url: 'https://www11.myfantasyleague.com/2026/home/LFCFS', franchise_id: '0001', franchise_name: 'Me' },
      ] } };
    case 'league': return leagueExport(String(opts.L));
    case 'rosters': return { rosters: { franchise: [{ id: opts.FRANCHISE || '0001', player: [{ id: '1', status: 'starter' }, { id: '2', status: 'nonstarter' }] }] } };
    case 'freeAgents': return { freeAgents: { leagueUnit: { player: [{ id: '50' }, { id: '51' }] } } };
    case 'players': return { players: { player: PLAYERS } };
    case 'projectedScores': return { projectedScores: { playerScore: [] } };
    case 'nflSchedule': return { nflSchedule: { week: '3', matchup: [] } };
    case 'calendar': return { calendar: state.calendar };
    case 'pendingWaivers': return { pendingWaivers: state.pending };
    case 'transactions': return { transactions: state.transactions };
    default: return {};
  }
};

let imports = [];
mfl.importRequest = async (type, params) => { imports.push({ type, params }); return { status: 'ok' }; };

const waivers = require('../../src/services/waivers');
const CK = 'ck', TK = 'tk';

(async () => {
  // 1) FAAB: two bids queued in round 2. Cancel the FIRST (idx 0) → resubmit the round with REPLACE
  //    and ONLY the second bid preserved (in add_bid_drop form). Confirms the survivor — including a
  //    claim placed outside the app — is not wiped.
  state.calendar = { event: [{ title: 'Lock All Free Agents', start: past }] };
  state.pending = { blindBidWaiverRequest: { round: '2', addsDrops: '50_5_2,51_9_0000' } };
  imports = [];
  const r1 = await waivers.cancel(CK, TK, 'LFAAB', 'mfl-faab-2-0');
  const bb = imports.find((i) => i.type === 'blindBidWaiverRequest');
  assert(bb, 'FAAB cancel resubmits via blindBidWaiverRequest');
  assert(bb.params.ROUND === 2, `same round preserved, got ${bb.params.ROUND}`);
  assert(bb.params.REPLACE, 'REPLACE is set (replace, not append)');
  assert(bb.params.PICKS === '51_9_0000', `only the surviving bid remains, got "${bb.params.PICKS}"`);
  assert(r1.canceled === 'mfl-faab-2-0', 'reports what was canceled');
  console.log('✓ FAAB cancel one of two: blindBidWaiverRequest REPLACE PICKS=51_9_0000 ROUND=2');

  // 2) FAAB: cancel the LAST remaining bid → empty PICKS clears the whole round.
  state.pending = { blindBidWaiverRequest: { round: '2', addsDrops: '50_5_2' } };
  imports = [];
  await waivers.cancel(CK, TK, 'LFAAB', 'mfl-faab-2-0');
  const bb2 = imports.find((i) => i.type === 'blindBidWaiverRequest');
  assert(bb2 && bb2.params.PICKS === '' && bb2.params.REPLACE && bb2.params.ROUND === 2,
    `last bid → empty PICKS clears round, got ${JSON.stringify(bb2 && bb2.params)}`);
  console.log('✓ FAAB cancel the last bid: empty PICKS clears the round');

  // 3) FCFS: cancel one of two priority claims in round 4 → waiverRequest, REPLACE, survivor kept.
  state.calendar = { event: [{ title: 'Lock All Free Agents', start: past }] };
  state.pending = { waiverRequest: { round: '4', addsDrops: '50_2,51_0000' } };
  imports = [];
  await waivers.cancel(CK, TK, 'LFCFS', 'mfl-fcfs-4-1');
  const wr = imports.find((i) => i.type === 'waiverRequest');
  assert(wr && wr.params.ROUND === 4 && wr.params.REPLACE && wr.params.PICKS === '50_2',
    `FCFS cancel idx1 → waiverRequest REPLACE PICKS=50_2, got ${JSON.stringify(wr && wr.params)}`);
  console.log('✓ FCFS cancel one of two: waiverRequest REPLACE PICKS=50_2 ROUND=4');

  // 4) Round already gone on MFL (processed/cleared) → no write, no throw; still reports canceled.
  state.pending = {};
  imports = [];
  const r4 = await waivers.cancel(CK, TK, 'LFAAB', 'mfl-faab-2-0');
  assert(!imports.length, 'nothing queued for the round → no MFL write');
  assert(r4.canceled === 'mfl-faab-2-0', 'still reports canceled (already gone is success)');
  console.log('✓ round already cleared on MFL: no-op write, reported canceled');

  // 5) MFL rejects the resubmit → surfaces the detail (never a bare status), does not swallow it.
  state.pending = { blindBidWaiverRequest: { round: '2', addsDrops: '50_5_2,51_9_0000' } };
  imports = [];
  const savedImport = mfl.importRequest;
  mfl.importRequest = async () => { const e = new Error('bad'); e.status = 400; e.mflError = 'Waivers are locked'; throw e; };
  let threw = false;
  try { await waivers.cancel(CK, TK, 'LFAAB', 'mfl-faab-2-0'); }
  catch (e) { threw = true; assert(/Waivers are locked/.test(e.message) || /rejected the cancel/.test(e.message), `surfaces MFL detail, got "${e.message}"`); }
  mfl.importRequest = savedImport;
  assert(threw, 'a rejected cancel throws (the claim would still process otherwise)');
  console.log('✓ MFL rejection surfaces the error detail');

  // 6) DEMO: cancel is store-only — no MFL write path. A submitted claim is removed from the store.
  process.env.MFL_DEMO_MODE = 'true';
  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/services/waivers')];
  const waiversDemo = require('../../src/services/waivers');
  imports = [];
  // Canceling an unknown id in demo → 404 (store-only), and NO import fired.
  let demo404 = false;
  try { await waiversDemo.cancel(CK, TK, '0001', 'does-not-exist'); }
  catch (e) { demo404 = e.status === 404; }
  assert(demo404, 'demo cancel of an unknown id → 404 (store-only)');
  assert(!imports.length, 'demo cancel fires NO MFL import');
  console.log('✓ demo: cancel is store-only (no MFL write)');

  console.log('\nWAIVER CANCEL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
