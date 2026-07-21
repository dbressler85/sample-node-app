'use strict';
// Stubbed LIVE-mode harness for the newly wired data: player-hub free agents +
// per-league projection, roster picks + byes, and Home pending trades.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

// Stub the external enrichment providers (FantasyCalc + Sleeper).
const FC = [
  { player: { mflId: '99', sleeperId: 'S99', maybeAge: 24, position: 'QB' }, value: 8000, overallRank: 3 },
  { player: { mflId: '1', sleeperId: 'S1', maybeAge: 27, position: 'WR' }, value: 4000, overallRank: 20 },
];
const SLEEPER = [{ player_id: 'S99', count: 777 }];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : url.includes('sleeper') ? SLEEPER : []) });

const PLAYERS = [
  { id: '1', name: 'Alpha, WR', position: 'WR', team: 'AAA' },
  { id: '2', name: 'Bravo, RB', position: 'RB', team: 'BYE' }, // team on bye this week
  { id: '99', name: 'Charlie, QB', position: 'QB', team: 'CCC' }, // free agent
  { id: '50', name: 'Delta, WR', position: 'WR', team: 'DDD' }, // on another team
];
const PROJ = { '1': 15, '2': 12, '99': 18, '50': 20 };
const PLAYING = ['AAA', 'CCC', 'DDD']; // 'BYE' team absent -> on bye

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Test League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'rosters':
      return { rosters: { franchise: [{ id: opts.FRANCHISE || '0001', player: ['1', '2'].map((id) => ({ id, status: 'starter' })) }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '99' }] } } };
    case 'topOwns':
      return { topOwns: { player: [{ id: '99', percent: '64.2' }, { id: '1', percent: '88.0' }] } };
    case 'topAdds':
      return { topAdds: { player: [{ id: '99', adds: '300' }, { id: '1', adds: '200' }] } };
    case 'projectedScores':
      return { projectedScores: { playerScore: Object.entries(PROJ).map(([id, s]) => ({ id, score: String(s) })) } };
    case 'playerScores': {
      // Actual points for player '1': YTD 40, AVG 13.3, wk1 15, wk2 25.
      if (String(opts.PLAYERS) !== '1') return { playerScores: { playerScore: [] } };
      const byW = { YTD: '40', AVG: '13.3', '1': '15', '2': '25' };
      const score = byW[String(opts.W)];
      return { playerScores: { playerScore: score != null ? [{ id: '1', score }] : [] } };
    }
    case 'league':
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] }, franchises: { franchise: [{ id: '0001', name: 'My Team' }, { id: '0002', name: 'Rival Squad' }] } } };
    case 'injuries':
      return { injuries: { injury: [{ id: '1', status: 'QUESTIONABLE' }] } };
    case 'nflSchedule':
      return { nflSchedule: { matchup: PLAYING.map((t) => ({ team: [{ id: t }] })) } };
    case 'schedule':
      return { schedule: { weeklySchedule: [{ week: '3', matchup: [{ franchise: [{ id: '0001' }, { id: '0002' }] }] }] } };
    case 'pendingTrades':
      return { pendingTrades: { pendingTrade: [{ trade_id: 'TR1', offeringteam: '0002', offeredto: '0001', willGiveUp: '50', willReceiveInReturn: '1' }] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [{ year: '2027', round: '1' }, { year: '2027', round: '2' }] } } };
    default:
      return {};
  }
};

const roster = require('../../src/services/roster');
const playerhub = require('../../src/services/playerhub');
const portfolio = require('../../src/services/portfolio');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TK = 'tk';

  // ROSTER: live picks + byes.
  const r = await roster.getRoster(CK, '1000');
  console.log('picks:', r.picks);
  // Picks are now first-class asset objects (token + label + year/round + value), sorted
  // soonest-first, so they can be shopped/traded straight from the roster.
  assert(r.picks.map((p) => p.label).join(',') === '2027 1st,2027 2nd', 'future draft picks resolved (labels)');
  assert(r.picks.every((p) => p.token && p.value > 0 && p.year === 2027), 'each pick carries a trade token + value + year');
  const bravo = r.starters.find((p) => p.id === '2');
  assert(bravo && bravo.availability.status === 'BYE', `bye applied to roster player, got ${bravo && bravo.availability.status}`);
  const alpha = r.starters.find((p) => p.id === '1');
  assert(alpha.availability.status === 'QUESTIONABLE', 'live injury applied to roster player');
  console.log('✓ roster: picks + byes + injuries wired');

  // PLAYER HUB: free agent + per-league projection + outlook.
  const prof = await playerhub.profile(CK, TK, '99');
  console.log('profile 99:', JSON.stringify({ x: prof.crossLeague, outlook: prof.outlook, add: prof.actions.addLeagues }));
  assert(prof.crossLeague[0].relation === 'free', 'FA is free in the league (live freeAgents wired)');
  assert(prof.crossLeague[0].leagueProjection === 18, `per-league live projection = 18, got ${prof.crossLeague[0].leagueProjection}`);
  assert(prof.outlook && prof.outlook.median === 18, 'headline outlook derived from live projection');
  assert(prof.actions.addLeagues.length === 1, 'add-across-leagues sees the FA in live');
  console.log('✓ player hub: live free agents + projections + outlook wired');

  // ENRICHMENT flows onto the profile: value (normalized), age, trend.
  assert(prof.value === 100, `enriched value 100 (8000/8000), got ${prof.value}`);
  assert(prof.age === 24, `enriched age 24, got ${prof.age}`);
  // trend combines Sleeper (777 via crosswalk) + MFL topAdds (300) = 1077.
  assert(prof.trend === 1077, `combined Sleeper+MFL trend 1077, got ${prof.trend}`);
  assert(prof.overallRank === 1, `dynasty rank recomputed from values, got ${prof.overallRank}`);
  assert(prof.ownership === 64.2, `MFL topOwns ownership 64.2%, got ${prof.ownership}`);
  console.log(`✓ enrichment on profile: value ${prof.value}, age ${prof.age}, trend ${prof.trend} (Sleeper+MFL), owned ${prof.ownership}%`);

  // PLAYER HUB: live game log + season from playerScores (player '1').
  const p1 = await playerhub.profile(CK, TK, '1');
  console.log('season:', JSON.stringify(p1.season), 'log:', JSON.stringify(p1.gameLog));
  assert(p1.season && p1.season.points === 40, `season points 40, got ${p1.season && p1.season.points}`);
  assert(p1.season.ppg === 13.3, `ppg 13.3, got ${p1.season.ppg}`);
  assert(p1.season.games === 3, `games ~3 (40/13.3), got ${p1.season.games}`);
  assert(p1.gameLog.length === 2 && p1.gameLog[0].week === 1 && p1.gameLog[1].pts === 25, 'recent game log built from weekly scores');
  // Player '1' isn't in Sleeper trending, so its trend (200) comes purely from
  // MFL topAdds — proving MFL covers players the Sleeper crosswalk misses.
  assert(p1.trend === 200, `MFL-only trend 200 (no Sleeper), got ${p1.trend}`);
  console.log('✓ player hub: live game log + season wired; MFL topAdds covers crosswalk misses');

  // HOME: live pending trade offer with resolved names.
  const home = await portfolio.getHome(CK, TK);
  const trade = home.triage.find((t) => t.type === 'trade_offer');
  console.log('trade item:', JSON.stringify(trade), '| tradeOffers:', home.portfolio.tradeOffers);
  assert(trade, 'pending trade surfaced on Home');
  assert(trade.title === 'Trade offer from Rival Squad', `trade from resolved name, got "${trade.title}"`);
  assert(/Delta/.test(trade.subtitle) && /Alpha/.test(trade.subtitle), `trade detail resolves player names, got "${trade.subtitle}"`);
  assert(home.portfolio.tradeOffers === 1, 'trade counted in portfolio');
  console.log('✓ home: live pending trades wired (names resolved)');

  console.log('\nLIVE HUB HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
