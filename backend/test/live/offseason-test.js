'use strict';
// Verify the Home command-center pivots in the offseason: no lineup triage,
// dynasty summary attached, trades still surfaced. LIVE mode, no active week.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK; // no active week -> offseason

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'Star WR', position: 'WR', team: 'AAA' },
  { id: '2', name: 'Young RB', position: 'RB', team: 'BBB' },
  { id: '20', name: 'Their WR', position: 'WR', team: 'CCC' },
];
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Dynasty', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] }, franchises: { franchise: [{ id: '0001', name: 'My Team' }, { id: '0002', name: 'Rival Squad' }] } } };
    case 'rosters':
      return { rosters: { franchise: [{ id: opts.FRANCHISE || '0001', player: ['1', '2'].map((id) => ({ id, status: 'starter' })) }] } };
    case 'pendingTrades':
      return { pendingTrades: { pendingTrade: [{ trade_id: 'TR1', offeringteam: '0002', offeredto: '0001', willGiveUp: '20', willReceiveInReturn: '1' }] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    case 'injuries':
      return { injuries: { injury: [] } };
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '1', sleeperId: 's1', maybeAge: 27 }, value: 9000, overallRank: 1 },
  { player: { mflId: '2', sleeperId: 's2', maybeAge: 24 }, value: 5400, overallRank: 8 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const portfolio = require('../../src/services/portfolio');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TK = 'tk';

  const tri = await portfolio.getLeagueTriage(CK, TK, '1000');
  console.log('triage:', JSON.stringify({ phase: tri.phase, status: tri.status, dynasty: tri.dynasty, items: tri.items.map((i) => i.type) }));
  assert(tri.phase === 'offseason', 'phase is offseason');
  assert(tri.dynasty && tri.dynasty.value === 160, `dynasty value 160 (100+60), got ${tri.dynasty && tri.dynasty.value}`);
  assert(!tri.items.some((i) => i.type.startsWith('lineup_')), 'no lineup triage in offseason');
  assert(tri.items.some((i) => i.type === 'trade_offer'), 'trade offer still surfaced');
  console.log('✓ per-league: offseason drops lineups, keeps trades, adds dynasty summary');

  const home = await portfolio.getHome(CK, TK);
  console.log('home portfolio:', JSON.stringify(home.portfolio));
  assert(home.phase === 'offseason', 'home phase offseason');
  assert(home.portfolio.rosterValue === 160, `rollup roster value 160, got ${home.portfolio.rosterValue}`);
  assert(home.portfolio.avgCoreAge === 25.5, `avg core age 25.5, got ${home.portfolio.avgCoreAge}`);
  assert(home.teams[0].dynasty && home.teams[0].dynasty.outlook, 'team carries dynasty outlook');
  assert(!home.triage.some((i) => i.type.startsWith('lineup_')), 'no lineup items in home triage');
  assert(home.portfolio.tradeOffers === 1, 'trade offer counted');
  console.log(`✓ home rollup: value ${home.portfolio.rosterValue}, avg core ${home.portfolio.avgCoreAge}y, ${home.portfolio.tradeOffers} trade`);

  console.log('\nOFFSEASON HOME HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
