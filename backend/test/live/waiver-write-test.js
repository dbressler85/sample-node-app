'use strict';
// LIVE write-path correctness for the MFL Import API (docs/MFL_API_AUDIT.md §2), including the
// waiver WINDOW routing (#71): when free agency is OPEN, an add is an immediate fcfsWaiver; when
// LOCKED, it's a queued claim (blindBidWaiverRequest / waiverRequest) using the round from
// pendingWaivers. Pins the exact import TYPE + params for each case.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My, Starter', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My, Bench', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free, Agent', position: 'RB', team: 'CCC' },
];
global.fetch = async () => ({ ok: true, json: async () => [] });

const past = String(Math.floor(Date.now() / 1000) - 86400);
// Mutable per-scenario state the stub reads.
const state = {
  calendar: { event: [] },                 // [] → open; a past "lock" event → locked
  pending: {},                             // pendingWaivers payload (carries the round)
};

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
    case 'freeAgents': return { freeAgents: { leagueUnit: { player: [{ id: '50' }] } } };
    case 'players': return { players: { player: PLAYERS } };
    case 'projectedScores': return { projectedScores: { playerScore: [{ id: '50', score: '12' }] } };
    case 'nflSchedule': return { nflSchedule: { week: '3', matchup: [{ team: [{ id: 'CCC' }, { id: 'ZZZ' }] }] } };
    case 'calendar': return { calendar: state.calendar };
    case 'pendingWaivers': return { pendingWaivers: state.pending };
    default: return {};
  }
};

let imports = [];
mfl.importRequest = async (type, params) => { imports.push({ type, params }); return { status: 'ok' }; };

const waivers = require('../../src/services/waivers');
const playerhub = require('../../src/services/playerhub');
const CK = 'ck', TK = 'tk';
const lockEvent = { title: 'Lock All Free Agents', start: past };
const unlockEvent = { title: 'Allow Add/Drops', start: past };

(async () => {
  // 1) LOCKED FAAB + known round → blindBidWaiverRequest, PICKS add_bid_drop, ROUND from pending.
  state.calendar = { event: [lockEvent] };
  state.pending = { blindBidWaiverRequest: { round: '2', addsDrops: '99_0_0000' } };
  imports = [];
  await waivers.submit(CK, TK, 'LFAAB', { addId: '50', dropId: '2', bid: 5 });
  const bb = imports.find((i) => i.type === 'blindBidWaiverRequest');
  assert(bb && bb.params.PICKS === '50_5_2', `locked FAAB → blindBidWaiverRequest PICKS 50_5_2, got ${bb && bb.params.PICKS}`);
  assert(bb.params.ROUND === 2, `ROUND sourced from pendingWaivers, got ${bb.params.ROUND}`);
  assert(!imports.some((i) => i.type === 'fcfsWaiver'), 'no immediate add when locked');
  console.log('✓ locked FAAB: blindBidWaiverRequest PICKS=50_5_2 ROUND=2');

  // 2) OPEN FAAB (unlock is the latest event) → immediate fcfsWaiver, no bid.
  state.calendar = { event: [unlockEvent] };
  state.pending = {};
  imports = [];
  await waivers.submit(CK, TK, 'LFAAB', { addId: '50', dropId: '2', bid: 5 });
  const fc = imports.find((i) => i.type === 'fcfsWaiver');
  assert(fc && String(fc.params.ADD) === '50' && String(fc.params.DROP) === '2', `open FAAB → fcfsWaiver ADD 50 DROP 2, got ${JSON.stringify(fc && fc.params)}`);
  assert(!imports.some((i) => i.type === 'blindBidWaiverRequest'), 'no bid when the window is open');
  console.log('✓ open FAAB: immediate fcfsWaiver ADD=50 DROP=2 (no bid)');

  // 3) LOCKED FCFS + known round → waiverRequest, ROUND + PICKS add_drop.
  state.calendar = { event: [lockEvent] };
  state.pending = { waiverRequest: { round: '4', addsDrops: '99_0000' } };
  imports = [];
  await waivers.submit(CK, TK, 'LFCFS', { addId: '50', dropId: '2' });
  const wr = imports.find((i) => i.type === 'waiverRequest');
  assert(wr && wr.params.ROUND === 4 && wr.params.PICKS === '50_2', `locked FCFS → waiverRequest ROUND 4 PICKS 50_2, got ${JSON.stringify(wr && wr.params)}`);
  console.log('✓ locked FCFS: waiverRequest ROUND=4 PICKS=50_2');

  // 4) LOCKED FCFS + NO round available → honest 501, no write.
  state.calendar = { event: [lockEvent] };
  state.pending = {};
  imports = [];
  let threw = false;
  try { await waivers.submit(CK, TK, 'LFCFS', { addId: '50', dropId: '2' }); }
  catch (e) { threw = true; assert(e.status === 501, `locked FCFS w/o round → 501, got ${e.status}`); }
  assert(threw && imports.length === 0, 'no MFL write when the FCFS round is unknown');
  console.log('✓ locked FCFS, no round: 501, no write');

  // 5) Drop (playerhub) is always an immediate fcfsWaiver DROP — unaffected by the window.
  state.calendar = { event: [] };
  imports = [];
  const res = await playerhub.submitDrop(CK, TK, '2', ['LFAAB']);
  assert(res.results.some((r) => r.leagueId === 'LFAAB' && r.ok), `drop ok: ${JSON.stringify(res.results)}`);
  const d = imports.find((i) => i.type === 'fcfsWaiver');
  assert(d && String(d.params.DROP) === '2' && d.params.ADD === undefined, `drop → fcfsWaiver DROP=2 no ADD, got ${JSON.stringify(d && d.params)}`);
  console.log('✓ drop: fcfsWaiver DROP=2, no ADD');

  console.log('\nWAIVER WRITE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
