'use strict';
// Pick Capital's shop/acquire partner targeting. From ONE league, pickPartners ranks rivals for a
// pick-oriented deal and pre-builds a suggested, value-balanced trade:
//   • 'acquire' (get picks) → WIN-NOW teams sitting on pick equity; I send a player, receive their pick.
//                             A REBUILDING team hoards picks, so it must NOT be offered as a target.
//   • 'shop'    (cash picks) → REBUILDING teams holding an aging valuable vet; I send picks, receive
//                             the vet. A WIN-NOW team won't sell its vets, so it must NOT be a target.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');

// id → position. Ages/values come from the fantasycalc mock below.
const PLAYERS = [
  { id: '1', name: 'My RB', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My WR', position: 'WR', team: 'BBB' },
  { id: '10', name: 'Win QB', position: 'QB', team: 'CCC' },
  { id: '11', name: 'Win RB', position: 'RB', team: 'DDD' },
  { id: '12', name: 'Win WR', position: 'WR', team: 'EEE' },
  { id: '20', name: 'Vet, Aging', position: 'WR', team: 'FFF' },
  { id: '21', name: 'Rebuild RB', position: 'RB', team: 'GGG' },
  { id: '22', name: 'Rebuild TE', position: 'TE', team: 'HHH' },
];
// 0002 = win-now (strong + old core) with pick equity. 0003 = rebuilding (weakest) with an aging vet.
const ROSTERS = {
  '0001': ['1', '2'],
  '0002': ['10', '11', '12'],
  '0003': ['20', '21', '22'],
};
// Assets (authoritative picks): me + the win-now team hold picks; the rebuilder holds none.
const ASSETS = [
  { id: '0001', futureYearDraftPicks: { draftPick: [{ pick: 'FP_0001_2027_1', description: '' }, { pick: 'FP_0001_2027_2', description: '' }] } },
  { id: '0002', futureYearDraftPicks: { draftPick: [{ pick: 'FP_0002_2027_1', description: '' }] } },
  { id: '0003', futureYearDraftPicks: { draftPick: [] } },
];

mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Pick Trade League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: {
        starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '2' }, { name: 'WR', limit: '2' }, { name: 'TE', limit: '1' }] },
        franchises: { franchise: [{ id: '0001', name: 'My Team' }, { id: '0002', name: 'Contenders' }, { id: '0003', name: 'Rebuild Crew' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: Object.entries(ROSTERS).map(([id, ids]) => ({ id, player: ids.map((pid) => ({ id: pid, status: 'starter' })) })) } };
    case 'assets':
      return { assets: { franchise: ASSETS } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'pendingTrades':
      return {};
    default:
      return {};
  }
};

// value (×100 → display) + age. 0002 is a strong, OLD core; 0003 is weak but owns one aging 60-value vet.
const FC = [
  { player: { mflId: '1', maybeAge: 25 }, value: 5000, overallRank: 40 },  // 50
  { player: { mflId: '2', maybeAge: 24 }, value: 4500, overallRank: 45 },  // 45
  { player: { mflId: '10', maybeAge: 28 }, value: 9000, overallRank: 3 },  // 90
  { player: { mflId: '11', maybeAge: 29 }, value: 8500, overallRank: 5 },  // 85
  { player: { mflId: '12', maybeAge: 27 }, value: 8000, overallRank: 8 },  // 80
  { player: { mflId: '20', maybeAge: 30 }, value: 6000, overallRank: 20 }, // 60 aging vet
  { player: { mflId: '21', maybeAge: 22 }, value: 1000, overallRank: 90 }, // 10
  { player: { mflId: '22', maybeAge: 21 }, value: 800, overallRank: 95 },  // 8
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TOK = 'tok';

  // --- ACQUIRE: get picks → target the win-now team's pick equity, pay with a player ---------------
  const acq = await trades.pickPartners(CK, TOK, '1000', 'acquire');
  console.log('acquire partners:', acq.partners.map((p) => `${p.name}[${p.outlook}] recv ${p.deal.receive.map((a) => a.name).join('+')} for ${p.deal.send.map((a) => a.name).join('+')}`));
  assert(acq.intent === 'acquire', 'echoes the intent');
  assert(acq.partners.length >= 1, 'at least one acquire partner');
  const top = acq.partners[0];
  assert(top.franchiseId === '0002' && top.outlook === 'Win-now window', `top acquire partner is the win-now team, got ${top.franchiseId}/${top.outlook}`);
  assert(top.deal.receive.length === 1 && top.deal.receive[0].kind === 'pick', 'I receive their pick');
  assert(top.deal.send.length >= 1 && top.deal.send.every((a) => a.kind === 'player'), 'I send player(s), not picks');
  assert(!acq.partners.some((p) => p.franchiseId === '0003'), 'a REBUILDING team is never an acquire target (it hoards picks)');
  console.log('✓ acquire: win-now pick-holder targeted; send a player, get their pick');

  // --- SHOP: cash picks → target the rebuilder's aging vet, pay with picks -------------------------
  const shop = await trades.pickPartners(CK, TOK, '1000', 'shop');
  console.log('shop partners:', shop.partners.map((p) => `${p.name}[${p.outlook}] recv ${p.deal.receive.map((a) => a.name).join('+')} for ${p.deal.send.map((a) => a.name).join('+')}`));
  assert(shop.partners.some((p) => p.franchiseId === '0003'), 'the rebuilding team is a shop target');
  const reb = shop.partners.find((p) => p.franchiseId === '0003');
  assert(reb.outlook === 'Rebuilding', `shop target reads rebuilding, got ${reb.outlook}`);
  assert(reb.deal.receive.length === 1 && reb.deal.receive[0].id === '20', `I receive their aging vet, got ${JSON.stringify(reb.deal.receive)}`);
  assert(reb.deal.send.length >= 1 && reb.deal.send.every((a) => a.kind === 'pick'), 'I send picks, not players');
  assert(!shop.partners.some((p) => p.franchiseId === '0002'), 'a WIN-NOW team is never a shop target (it keeps its vets)');
  console.log('✓ shop: rebuilding aging-vet holder targeted; send picks, get their vet');

  console.log('\nPICK PARTNERS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
