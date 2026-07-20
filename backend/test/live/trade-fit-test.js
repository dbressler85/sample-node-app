'use strict';
// The trade desk surfaces each team's positional NEEDS and SURPLUS (league-relative,
// from the starting-lineup requirements) and suggests a fair offer biased to the
// partner's needs from your surplus. This proves:
//   * a partner with no RB shows an RB need; a team three-deep at RB shows RB surplus;
//   * suggestFor returns a fair-value package AND, between equal-value options, prefers
//     the one at the partner's need position (value first, fit as the tiebreak).
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');

// positions + values. Partner 0002 owns the target (WR 20) and is bare at RB.
const PLAYERS = [
  { id: '2', name: 'My RB, Fit', position: 'RB', team: 'AAA' },
  { id: '3', name: 'My WR, NoFit', position: 'WR', team: 'BBB' },
  { id: '4', name: 'My RB1', position: 'RB', team: 'CCC' },
  { id: '5', name: 'My WR1', position: 'WR', team: 'DDD' },
  { id: '6', name: 'My QB1', position: 'QB', team: 'EEE' },
  { id: '7', name: 'My RB3', position: 'RB', team: 'FFF' },
  { id: '20', name: 'Target WR', position: 'WR', team: 'GGG' },
  { id: '21', name: 'Their WR1', position: 'WR', team: 'HHH' },
  { id: '22', name: 'Their QB1', position: 'QB', team: 'III' },
  { id: '30', name: 'Rival RB1', position: 'RB', team: 'JJJ' },
  { id: '31', name: 'Rival RB2', position: 'RB', team: 'KKK' },
  { id: '32', name: 'Rival WR1', position: 'WR', team: 'LLL' },
];
const ROSTERS = {
  '0001': ['4', '2', '7', '5', '3', '6'], // RB deep: 60,50,45 -> surplus RB
  '0002': ['20', '21', '22'],             // WR + QB, NO RB -> RB need
  '0003': ['30', '31', '32'],             // strong RBs -> lifts league RB median
};
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Fit League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: {
        starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '2' }, { name: 'WR', limit: '2' }] },
        franchises: { franchise: [{ id: '0001', name: 'My Team' }, { id: '0002', name: 'Rival A' }, { id: '0003', name: 'Rival B' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: Object.entries(ROSTERS).map(([id, ids]) => ({ id, player: ids.map((pid) => ({ id: pid, status: 'starter' })) })) } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    case 'pendingTrades':
      return {};
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '2', maybeAge: 25 }, value: 5000, overallRank: 30 },  // 50
  { player: { mflId: '3', maybeAge: 25 }, value: 5000, overallRank: 31 },  // 50
  { player: { mflId: '4', maybeAge: 25 }, value: 6000, overallRank: 20 },  // 60
  { player: { mflId: '5', maybeAge: 25 }, value: 6000, overallRank: 21 },  // 60
  { player: { mflId: '6', maybeAge: 25 }, value: 7000, overallRank: 10 },  // 70
  { player: { mflId: '7', maybeAge: 25 }, value: 4500, overallRank: 40 },  // 45
  { player: { mflId: '20', maybeAge: 25 }, value: 5000, overallRank: 32 }, // 50 target
  { player: { mflId: '21', maybeAge: 25 }, value: 7000, overallRank: 11 }, // 70
  { player: { mflId: '22', maybeAge: 25 }, value: 6500, overallRank: 15 }, // 65
  { player: { mflId: '30', maybeAge: 25 }, value: 8000, overallRank: 5 },  // 80
  { player: { mflId: '31', maybeAge: 25 }, value: 7500, overallRank: 8 },  // 75
  { player: { mflId: '32', maybeAge: 25 }, value: 7000, overallRank: 12 }, // 70
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TOK = 'tok';

  const lg = await trades.getLeague(CK, TOK, '1000');
  const partner = lg.partners.find((p) => p.franchiseId === '0002');
  console.log('me needs/surplus:', JSON.stringify(lg.me));
  console.log('partner needs/surplus:', JSON.stringify({ needs: partner.needs, surplus: partner.surplus }));
  assert(partner.needs.some((n) => n.pos === 'RB'), 'partner with no RB shows an RB need');
  assert(lg.me.surplus.some((s) => s.pos === 'RB'), 'my three-deep RB room shows RB surplus');
  console.log('✓ desk surfaces league-relative needs & surplus for both teams');

  const sug = await trades.suggestFor(CK, TOK, '1000', '20', '0002');
  console.log('suggest:', JSON.stringify(sug.give.map((g) => `${g.name} ${g.position} $${g.value}`)), '=>', sug.giveValue, 'for', sug.targetValue);
  assert(sug.targetValue > 0, 'target has a league value');
  // Fair: the package value lands within a fair band of the target (no gross overpay/underpay).
  assert(sug.giveValue >= sug.targetValue * 0.85 && sug.giveValue <= sug.targetValue * 1.25, `give is fair for the target (${sug.giveValue} vs ${sug.targetValue})`);
  // My equal-value RB and WR both qualify as a fair single; the partner needs RB, so fit breaks the tie.
  assert(sug.give.length === 1 && sug.give[0].position === 'RB', `prefers the need-position (RB) player, got ${JSON.stringify(sug.give)}`);
  assert(sug.partnerNeeds.some((n) => n.pos === 'RB'), 'suggestion carries the partner needs it fit to');
  console.log('✓ suggestFor: fair by value AND fit to the partner’s RB need —', sug.give.map((g) => g.name).join(' + '));

  console.log('\nTRADE FIT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
