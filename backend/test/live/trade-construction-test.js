'use strict';
// Incoming offers carry a roster-CONSTRUCTION read, not just value: does the deal fix a
// hole or open one? Here I'm thin at WR and deep at RB. Three offers prove the ratings:
//   * they want my WR (my need)                       -> caution ("don't do it")
//   * they send a WR (my need) for my RB (my depth)   -> good ("fills your WR need")
//   * an RB-for-RB swap that touches neither edge      -> neutral
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');

// My roster is WR-thin (one weak WR) and RB-deep (three strong RBs). Rival 0002 owns the
// pieces. Values via FC below; league starts 1 QB / 2 RB / 2 WR.
const PLAYERS = [
  { id: '1', name: 'My RB1', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My RB2', position: 'RB', team: 'BBB' },
  { id: '3', name: 'My RB3', position: 'RB', team: 'CCC' },
  { id: '4', name: 'My WR weak', position: 'WR', team: 'DDD' },
  { id: '5', name: 'My QB', position: 'QB', team: 'EEE' },
  { id: '20', name: 'Their WR stud', position: 'WR', team: 'FFF' },
  { id: '21', name: 'Their RB', position: 'RB', team: 'GGG' },
  { id: '22', name: 'Their WR2', position: 'WR', team: 'HHH' },
  { id: '30', name: 'Filler RB', position: 'RB', team: 'III' },
  { id: '31', name: 'Filler WR', position: 'WR', team: 'JJJ' },
  { id: '32', name: 'Filler WR2', position: 'WR', team: 'KKK' },
];
const ROSTERS = {
  '0001': ['1', '2', '3', '4', '5'],  // 3 RB (deep), 1 weak WR (thin), 1 QB
  '0002': ['20', '21', '22'],
  '0003': ['30', '31', '32'],          // lifts league medians so my WR reads thin, RB deep
};
// Three incoming offers from 0002 (seeded via pendingTrades won't carry three cleanly, so
// this test drives the store directly through getLeague which reads pendingTrades).
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Build League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: {
        starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '2' }, { name: 'WR', limit: '2' }] },
        franchises: { franchise: [{ id: '0001' }, { id: '0002' }, { id: '0003' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: Object.entries(ROSTERS).map(([id, ids]) => ({ id, player: ids.map((pid) => ({ id: pid, status: 'starter' })) })) } };
    case 'pendingTrades':
      return { pendingTrades: { pendingTrade: [
        { trade_id: 'A', offeringteam: '0002', offeredto: '0001', willGiveUp: '21', willReceiveInReturn: '4' },   // they give RB, want my thin WR -> caution
        { trade_id: 'B', offeringteam: '0002', offeredto: '0001', willGiveUp: '20', willReceiveInReturn: '1' },   // they give WR stud, want my RB1 -> good
        { trade_id: 'C', offeringteam: '0002', offeredto: '0001', willGiveUp: '21', willReceiveInReturn: '1' },   // RB for RB -> neutral
      ] } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '1', position: 'RB', maybeAge: 25 }, value: 8000, overallRank: 4 },
  { player: { mflId: '2', position: 'RB', maybeAge: 25 }, value: 7500, overallRank: 8 },
  { player: { mflId: '3', position: 'RB', maybeAge: 25 }, value: 7000, overallRank: 12 },
  { player: { mflId: '4', position: 'WR', maybeAge: 25 }, value: 2000, overallRank: 130 }, // weak WR
  { player: { mflId: '5', position: 'QB', maybeAge: 25 }, value: 6000, overallRank: 20 },
  { player: { mflId: '20', position: 'WR', maybeAge: 25 }, value: 8500, overallRank: 3 },
  { player: { mflId: '21', position: 'RB', maybeAge: 25 }, value: 6500, overallRank: 16 },
  { player: { mflId: '22', position: 'WR', maybeAge: 25 }, value: 6000, overallRank: 22 },
  { player: { mflId: '30', position: 'RB', maybeAge: 25 }, value: 3000, overallRank: 90 },
  { player: { mflId: '31', position: 'WR', maybeAge: 25 }, value: 8000, overallRank: 5 },
  { player: { mflId: '32', position: 'WR', maybeAge: 25 }, value: 7500, overallRank: 9 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const lg = await trades.getLeague('ck', 'tok', '1000');
  const me = lg.me;
  console.log('my needs:', JSON.stringify(me.needs), '| surplus:', JSON.stringify(me.surplus));
  assert(me.needs.some((n) => n.pos === 'WR'), 'I read as thin at WR');
  assert(me.surplus.some((s) => s.pos === 'RB'), 'I read as deep at RB');

  const byId = Object.fromEntries(lg.offers.map((o) => [o.id, o]));
  const A = byId.A, B = byId.B, C = byId.C;
  console.log('A (they want my WR):', JSON.stringify(A.construction));
  console.log('B (they send a WR for my RB):', JSON.stringify(B.construction));
  console.log('C (RB for RB):', JSON.stringify(C.construction));

  assert(A.construction.rating === 'caution' && A.construction.thins.includes('WR'), 'giving away my thin WR is a caution');
  assert(B.construction.rating === 'good' && B.construction.fills.includes('WR'), 'getting a WR at my need from RB depth is good');
  assert(C.construction.rating === 'neutral', 'an RB-for-RB that touches neither edge is neutral');
  console.log('✓ construction read: caution when it thins a need, good when it fills one from depth, else neutral');

  console.log('\nTRADE CONSTRUCTION HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
