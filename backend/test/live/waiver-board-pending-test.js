'use strict';
// getBoard reconciles its pending list with MFL's AUTHORITATIVE pendingWaivers in live: claims
// queued on MFL (even outside the app) show up, resolved to names, from the real addsDrops shape.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My, Starter', position: 'RB', team: 'AAA' },
  { id: '14080', name: 'Rookie, Riser', position: 'WR', team: 'CCC' },
  { id: '14849', name: 'Old, Vet', position: 'WR', team: 'DDD' },
];
global.fetch = async () => ({ ok: true, json: async () => [] });

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: 'L1', name: 'FAAB League', url: 'https://www45.myfantasyleague.com/2026/home/L1', franchise_id: '0001', franchise_name: 'Me' }] } };
    case 'league':
      return { league: { rosterSize: '20', minBid: '1', bbidWaivers: '1', franchises: { franchise: [{ id: '0001', name: 'Me', bbidAvailableBalance: '80' }] }, starters: { position: [{ name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] } } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: [{ id: '1', status: 'starter' }] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '14080' }] } } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'projectedScores':
      return { projectedScores: { playerScore: [{ id: '14080', score: '11' }] } };
    case 'pendingWaivers':
      // The real sample shape: two conditional bids, both dropping 14849.
      return { pendingWaivers: { blindBidWaiverRequest: { round: '1', addsDrops: '14080_5_14849,13133_0_14849' } } };
    default:
      return {};
  }
};

const waivers = require('../../src/services/waivers');

(async () => {
  const board = await waivers.getBoard('ck', 'tk', 'L1', {});
  assert(Array.isArray(board.pending) && board.pending.length === 2, `two MFL pending claims surfaced, got ${board.pending.length}`);
  const first = board.pending.find((p) => p.add && p.add.id === '14080');
  assert(first, 'the add=14080 claim is present');
  assert(first.add.name === 'Rookie, Riser', `add resolved to a name, got ${first.add && first.add.name}`);
  assert(first.drop && first.drop.name === 'Old, Vet', 'drop resolved to a name');
  assert(first.bid === 5 && first.round === 1 && first.source === 'mfl', `bid/round/source parsed, got ${JSON.stringify({ bid: first.bid, round: first.round, source: first.source })}`);
  // A player id we don't have (13133) still surfaces the claim (name falls back gracefully).
  const second = board.pending.find((p) => p.add && p.add.id === '13133');
  assert(second && second.bid === 0, 'second claim present with bid 0');
  console.log('✓ board pending reconciled from MFL pendingWaivers (names resolved, bid/round/source)');

  console.log('\nWAIVER BOARD PENDING HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
