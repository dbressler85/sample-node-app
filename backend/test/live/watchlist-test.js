'use strict';
// Stubbed LIVE-mode harness for the cross-league watchlist: star players, then
// verify the roll-up classifies each in every league (mine / free / trade target),
// carries enrichment value + availability, and that the profile reflects the star.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

const FC = [
  { player: { mflId: '99', sleeperId: 'S99', maybeAge: 24 }, value: 8000, overallRank: 1 },
  { player: { mflId: '1', sleeperId: 'S1', maybeAge: 27 }, value: 4000, overallRank: 20 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const PLAYERS = [
  { id: '1', name: 'Alpha, WR', position: 'WR', team: 'AAA' }, // on my roster
  { id: '2', name: 'Bravo, RB', position: 'RB', team: 'BBB' }, // on my roster
  { id: '99', name: 'Charlie, QB', position: 'QB', team: 'CCC' }, // free agent
  { id: '50', name: 'Delta, WR', position: 'WR', team: 'DDD' }, // on another team -> trade target
];

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Test League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: ['1', '2'].map((id) => ({ id, status: 'starter' })) }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '99' }] } } };
    case 'league':
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] }, franchises: { franchise: [{ id: '0001', name: 'My Team' }] } } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'nflSchedule':
      return { nflSchedule: { matchup: ['AAA', 'BBB', 'CCC', 'DDD'].map((t) => ({ team: [{ id: t }] })) } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    default:
      return {};
  }
};

const watchlist = require('../../src/services/watchlist');
const watchStore = require('../../src/store/watchlist');
const playerhub = require('../../src/services/playerhub');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TK = 'wl-test-tok';
  // Deterministic start regardless of any persisted state from a prior run.
  ['1', '2', '99', '50'].forEach((id) => watchStore.remove(TK, id));

  // Empty to start.
  const empty = await watchlist.getWatchlist(CK, TK);
  assert(empty.players.length === 0, 'starts empty');

  // Star one of each kind: mine (1), free agent (99), other team (50).
  watchlist.add(TK, '1');
  watchlist.add(TK, '99');
  watchlist.add(TK, '50');

  const wl = await watchlist.getWatchlist(CK, TK);
  console.log('watchlist:', JSON.stringify(wl.players.map((p) => ({ n: p.name, v: p.value, s: p.summary }))));
  assert(wl.players.length === 3, `three watched, got ${wl.players.length}`);
  assert(wl.totalLeagues === 1, `one league, got ${wl.totalLeagues}`);

  const byId = Object.fromEntries(wl.players.map((p) => [p.id, p]));
  assert(byId['1'].summary.mine === 1 && byId['1'].summary.free === 0 && byId['1'].summary.tradeTarget === 0, 'rostered player classified as mine');
  assert(byId['99'].summary.free === 1 && byId['99'].summary.mine === 0, 'free agent classified as free');
  assert(byId['50'].summary.tradeTarget === 1 && byId['50'].summary.mine === 0 && byId['50'].summary.free === 0, 'other-team player classified as trade target');
  assert(byId['99'].value === 100, `enriched value on watched FA (8000/8000=100), got ${byId['99'].value}`);
  assert(byId['1'].availability && byId['1'].availability.status, 'availability resolved on watched player');
  assert(byId['99'].leagues[0].relation === 'free', 'per-league relation present');
  // Free-somewhere sorts to the top.
  assert(wl.players[0].id === '99', `actionable (free) sorts first, got ${wl.players[0].id}`);
  console.log('✓ watchlist roll-up: mine / free / trade-target classified per league, enriched + sorted');

  // Profile reflects the star; unstarred is false.
  const starred = await playerhub.profile(CK, TK, '1');
  const notStarred = await playerhub.profile(CK, TK, '2');
  assert(starred.watched === true, 'profile.watched true for a starred player');
  assert(notStarred.watched === false, 'profile.watched false for an unstarred player');
  console.log('✓ profile.watched reflects the store');

  // Unstar removes it.
  watchlist.remove(TK, '99');
  const after = await watchlist.getWatchlist(CK, TK);
  assert(after.players.length === 2 && !after.players.some((p) => p.id === '99'), 'unstar removes from the roll-up');
  console.log('✓ unstar: removed from the list');

  // Clean up so the shared persist file isn't left with test tokens.
  ['1', '2', '99', '50'].forEach((id) => watchStore.remove(TK, id));

  console.log('\nWATCHLIST HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
