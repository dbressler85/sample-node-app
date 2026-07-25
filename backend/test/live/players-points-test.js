'use strict';
// Season-to-date points + current-week projection are surfaced on the Players surfaces (the new
// "useful for free agents / streaming" numbers), and the waiver board can SORT by current-year
// point total. Both come from full-league MFL exports (playerScores W=YTD, projectedScores W=week)
// via lib/pointsMaps. Also: a "K" position filter on the board must match kickers (stored as PK).
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '5';

const mfl = require('../../src/lib/mfl');

// Four free agents so the board has something to sort: two skill players with different YTD totals,
// one kicker (PK) and one defense (DEF) so the position filter has real targets.
const PLAYERS = [
  { id: '10', name: 'Alpha Back', position: 'RB', team: 'AAA' },
  { id: '11', name: 'Bravo Wideout', position: 'WR', team: 'BBB' },
  { id: '12', name: 'Charlie Kicker', position: 'PK', team: 'CCC' },
  { id: '13', name: 'Delta Defense', position: 'DEF', team: 'DDD' },
];
// YTD season totals (playerScores W=YTD) and this-week projections (projectedScores W=5).
const YTD = { 10: '142.6', 11: '188.2', 12: '77.0', 13: '95.5' };
const PROJ = { 10: '12.1', 11: '15.8', 12: '8.0', 13: '7.5' };

function baseExport(type, opts = {}) {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: 'L1', name: 'Test League', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001', franchise_name: 'Me' }] } };
    case 'league':
      return { league: {
        rosterSize: '20', minBid: '1', bbidWaivers: '1',
        franchises: { franchise: [{ id: '0001', bbidAvailableBalance: '80', waiverSortOrder: '3' }] },
        starters: { position: [{ name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: [] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: PLAYERS.map((p) => ({ id: p.id })) } } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'playerScores':
      // W=YTD (season total). Return the whole map when no PLAYERS scoping.
      return { playerScores: { playerScore: PLAYERS.map((p) => ({ id: p.id, score: YTD[p.id] })) } };
    case 'projectedScores':
      return { projectedScores: { playerScore: PLAYERS.map((p) => ({ id: p.id, score: PROJ[p.id] })) } };
    case 'nflSchedule':
      return { nflSchedule: { week: '5', matchup: [] } };
    default:
      return {};
  }
}
mfl.exportRequest = async (type, opts) => baseExport(type, opts);
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => [], text: async () => '{}' }); // FantasyCalc/Sleeper empty

const pointsMaps = require('../../src/lib/pointsMaps');
const waivers = require('../../src/services/waivers');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const CK = 'ck', TK = 'tk';
const L = { leagueId: 'L1', host: 'www10.myfantasyleague.com' };

(async () => {
  // pointsMaps: one YTD read + one week projection read → id→number maps.
  const pm = await pointsMaps.maps(CK, L, 5);
  assert(pm.season.get('11') === 188.2, `season map carries YTD points, got ${pm.season.get('11')}`);
  assert(pm.proj.get('11') === 15.8, `projection map carries week projection, got ${pm.proj.get('11')}`);
  console.log(`✓ pointsMaps: season(11)=${pm.season.get('11')} proj(11)=${pm.proj.get('11')}`);

  // Waiver board carries seasonPoints on every free agent…
  const board = await waivers.getBoard(CK, TK, 'L1', {});
  const fa11 = board.freeAgents.find((p) => p.id === '11');
  assert(fa11 && fa11.seasonPoints === 188.2, `board free agent carries seasonPoints, got ${fa11 && fa11.seasonPoints}`);
  console.log(`✓ board free agents carry seasonPoints (Bravo=${fa11.seasonPoints})`);

  // …and can sort by current-year point total (highest YTD first).
  const bySeason = await waivers.getBoard(CK, TK, 'L1', { sort: 'season' });
  const order = bySeason.freeAgents.map((p) => p.seasonPoints || 0);
  assert(order.every((v, i) => i === 0 || order[i - 1] >= v), `board sorts by season points desc, got ${JSON.stringify(order)}`);
  assert(bySeason.freeAgents[0].id === '11', `top by season points is the highest YTD player, got ${bySeason.freeAgents[0].id}`);
  console.log(`✓ board 'season' sort ranks by current-year point total: ${JSON.stringify(order)}`);

  // Position filter "K" must match kickers (stored as PK); "DEF" matches defenses.
  const kOnly = await waivers.getBoard(CK, TK, 'L1', { position: 'K' });
  assert(kOnly.freeAgents.length === 1 && kOnly.freeAgents[0].position === 'PK', `board "K" filter matches kickers (PK), got ${JSON.stringify(kOnly.freeAgents.map((p) => p.position))}`);
  const defOnly = await waivers.getBoard(CK, TK, 'L1', { position: 'DEF' });
  assert(defOnly.freeAgents.length === 1 && defOnly.freeAgents[0].position === 'DEF', 'board "DEF" filter matches defenses');
  console.log('✓ board position filter normalizes K→PK and matches DEF');

  console.log('\nPLAYERS POINTS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
