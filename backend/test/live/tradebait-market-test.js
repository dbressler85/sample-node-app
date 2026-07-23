'use strict';
// The trade block must reflect MFL's AUTHORITATIVE bait listing — the players AND picks you're
// shopping on MFL (including bait set on the site) — not just what was added in-app. And the new
// market view lists every OTHER franchise's block. This pins both against MFL's real tradeBait shape
// (verified live): rows of { franchise_id, willGiveUp: "id,id,DP_r_p,FP_o_y_r", inExchangeFor }.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// Stub the heavy service-level deps BEFORE requiring the service under test.
const leaguesService = require('../../src/services/leagues');
const rosterService = require('../../src/services/roster');
const playersLib = require('../../src/lib/players');
const enrichmentLib = require('../../src/lib/enrichment');
const nflLib = require('../../src/lib/nfl');
const mflRepo = require('../../src/lib/mflRepo');

const LEAGUE = { leagueId: '1000', name: 'League A', host: 'www49.myfantasyleague.com', franchiseId: '0001' };
const PLAYERS = new Map([
  ['16593', { id: '16593', name: 'Block, Star', position: 'WR', team: 'AAA' }],
  ['16165', { id: '16165', name: 'Rival, Bench', position: 'RB', team: 'BBB' }],
  ['15721', { id: '15721', name: 'Rival, Flex', position: 'WR', team: 'CCC' }],
  ['12620', { id: '12620', name: 'Other, Vet', position: 'TE', team: 'DDD' }],
]);

// MFL bait board: my franchise (0001) shopping a player + two picks, plus two rival blocks.
const BAITS = [
  { franchise_id: '0001', willGiveUp: '16593,DP_0_2,FP_0011_2027_1', inExchangeFor: 'Want a starting RB' },
  { franchise_id: '0006', willGiveUp: '16165,15721', inExchangeFor: '' },
  { franchise_id: '0011', willGiveUp: '12620,FP_0011_2028_1', inExchangeFor: 'Rebuilding — picks please' },
];

leaguesService.listLeagues = async () => [LEAGUE];
leaguesService.orderedLeagues = async () => [LEAGUE];
leaguesService.franchiseNames = async () => new Map([['0006', 'Team Six'], ['0011', 'The Rebuild']]);
playersLib.load = async () => PLAYERS;
enrichmentLib.snapshot = async () => ({ value: (id) => ({ '16593': 4200, '16165': 900, '15721': 1500, '12620': 700 })[String(id)] || 0, age: () => 25, trend: () => 0, ownership: () => null });
nflLib.currentWeek = async () => 3;
nflLib.injuryMap = async () => ({});
nflLib.byeMap = async () => ({});
rosterService.getRoster = async () => ({ starters: [{ id: '16593' }], bench: [], ir: [], taxi: [] });
rosterService.leagueFranchises = async () => [{ mine: true, byPos: {} }, { mine: false, franchiseId: '0006', name: 'Team Six', byPos: { WR: { best: 1000, depth: 1 } }, totalValue: 20000 }];
mflRepo.tradeBaits = async () => BAITS;

const tradebait = require('../../src/services/tradebait');

(async () => {
  // --- MY block: authoritative from MFL (player + both picks), with the asking-price note ---
  const block = await tradebait.getBlock('ck', 'tk');
  assert(block.leagues.length === 1, 'one league has bait');
  const lg = block.leagues[0];
  console.log('my block:', JSON.stringify(lg.players.map((p) => ({ id: p.id, kind: p.kind, name: p.name, value: p.value }))));
  assert(lg.players.length === 3, `player + 2 picks on my block (got ${lg.players.length})`);
  const star = lg.players.find((p) => p.id === '16593');
  assert(star && star.kind === 'player' && star.bucket === 'starter', 'the rostered player is resolved with his bucket');
  const picks = lg.players.filter((p) => p.kind === 'pick');
  assert(picks.length === 2 && picks.every((p) => p.position === 'PICK' && p.name && p.value != null), 'both picks resolved to labels + values');
  assert(lg.note === 'Want a starting RB', 'league surfaces MFL asking-price note');
  assert(lg.players[0].id === '16593', 'sorted by value (the star first)');
  console.log('✓ my block: real MFL bait — player + picks + note');

  // --- MARKET: every OTHER franchise's block (not mine) ---
  const market = await tradebait.getMarket('ck', 'tk');
  const m = market.leagues[0];
  const ids = m.teams.map((t) => t.franchiseId).sort();
  console.log('market teams:', JSON.stringify(m.teams.map((t) => ({ name: t.name, assets: t.assets.length, note: t.note }))));
  assert(ids.join(',') === '0006,0011', `market lists the two rival blocks, not mine (got ${ids.join(',')})`);
  const six = m.teams.find((t) => t.franchiseId === '0006');
  assert(six.name === 'Team Six' && six.assets.length === 2, 'rival team resolved with name + assets');
  const rebuild = m.teams.find((t) => t.franchiseId === '0011');
  assert(rebuild.note === 'Rebuilding — picks please', 'rival asking-price note surfaced');
  assert(rebuild.assets.some((a) => a.kind === 'pick'), 'rival block includes a pick');
  assert(market.totals.teams === 2, 'market totals count the rival teams');
  console.log('✓ market: rival blocks resolved (names, assets, notes), mine excluded');

  console.log('\nTRADEBAIT MARKET HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
