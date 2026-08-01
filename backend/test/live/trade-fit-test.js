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

  // --- unit: value-closeness beats a need-fitting OVERPAY (the "send 79 for 66" bug) ------------
  // Partner needs RB. My roster has a 79-value RB (fits their need) and a 66-value QB (exact fair).
  // The engine must pick the fair 66, not overpay 79 just because it fits — closeness dominates,
  // fit only breaks a near-tie.
  const tradefit = require('../../src/lib/tradefit');
  const give = tradefit.suggestGive(
    [{ id: 'rb', name: 'Fit RB', position: 'RB', value: 79 }, { id: 'qb', name: 'Fair QB', position: 'QB', value: 66 }],
    66,
    [{ pos: 'RB' }],
    new Set()
  );
  assert(give.length === 1 && give[0].id === 'qb', `picks the fair 66 over the fitting 79 overpay, got ${JSON.stringify(give.map((g) => `${g.name} ${g.value}`))}`);
  // And when a need-fitter is ALSO fairly priced, fit still wins the tie: two ~66 players, one at RB.
  const give2 = tradefit.suggestGive(
    [{ id: 'rb', name: 'Fit RB', position: 'RB', value: 65 }, { id: 'qb', name: 'Fair QB', position: 'QB', value: 66 }],
    66,
    [{ pos: 'RB' }],
    new Set()
  );
  assert(give2.length === 1 && give2[0].id === 'rb', `near-equal value → fit (RB) breaks the tie, got ${JSON.stringify(give2.map((g) => g.name))}`);
  console.log('✓ suggestGive: closeness beats need-fitting overpay; fit still wins a near-tie');

  // --- unit: two-sided suggester — trade from MY surplus, not MY scarcity ----------------------
  // The reported bug: acquiring a pick suggested my SCARCE WR (I roster only four) instead of a spare
  // TE (I'm three-deep) the partner NEEDS. Feed my own needs/surplus/depth and the engine must draw
  // the give from a position I can spare. My roster: 3 TEs (surplus) + 4 WRs (I'm thin) + a spare RB.
  const twoSided = require('../../src/lib/tradefit');
  const myRoster = [
    { id: 'te1', name: 'TE One', position: 'TE', value: 40 },
    { id: 'te2', name: 'TE Two', position: 'TE', value: 30 },
    { id: 'te3', name: 'TE Three', position: 'TE', value: 20 },
    { id: 'wr1', name: 'WR One', position: 'WR', value: 45 },
    { id: 'wr2', name: 'WR Two', position: 'WR', value: 35 },
    { id: 'rb1', name: 'RB One', position: 'RB', value: 50 },
  ];
  // I'm deep at TE (surplus), thin at WR (need); depth forces 1 TE and 3 WR starters — so trading a WR
  // would open a hole (4 bodies, must field 3), while a TE is spare (3 bodies, must field 1).
  const myCtx = {
    surplus: [{ pos: 'TE' }],
    needs: [{ pos: 'WR' }],
    depth: { TE: { slots: 1, threshold: 15, bodies: 3 }, WR: { slots: 3, threshold: 20, bodies: 4 } },
  };
  // Partner needs a TE. Acquire a pick worth ~one strong TE (40).
  const spare1 = twoSided.suggestGive(myRoster, 40, [{ pos: 'TE' }], new Set(), myCtx);
  console.log('two-sided single:', JSON.stringify(spare1.map((g) => `${g.name} ${g.position} ${g.value}`)));
  assert(spare1.every((g) => g.position !== 'WR'), `never ships my scarce WR, got ${JSON.stringify(spare1.map((g) => g.position))}`);
  assert(spare1.length === 1 && spare1[0].position === 'TE', `sends a spare TE the partner needs, got ${JSON.stringify(spare1.map((g) => g.name))}`);

  // A bigger pick (65) that no single TE covers → a MULTI-PIECE package from my surplus, still no WR.
  const spare2 = twoSided.suggestGive(myRoster, 65, [{ pos: 'TE' }], new Set(), myCtx);
  console.log('two-sided package:', JSON.stringify(spare2.map((g) => `${g.name} ${g.position} ${g.value}`)));
  assert(spare2.length >= 2, `assembles a multi-piece package to match a big pick, got ${spare2.length}`);
  assert(spare2.every((g) => g.position === 'TE'), `the package is built from my surplus TEs, not my WRs, got ${JSON.stringify(spare2.map((g) => g.position))}`);
  console.log('✓ two-sided suggestGive: deals from surplus (TE), avoids scarcity (WR), packages when needed');

  // suggestFor also values a PICK target — "trade FOR a pick you don't own" (the draft board's pick
  // trade icon). A pick token resolves to its pick-curve value, so a fair give package is suggested.
  const pickSug = await trades.suggestFor(CK, TOK, '1000', 'FP_0002_2027_1', '0002');
  console.log('pick-target suggest:', JSON.stringify({ tv: pickSug.targetValue, give: pickSug.give.map((g) => `${g.name} $${g.value}`) }));
  assert(pickSug.targetValue > 0, `a pick target is valued off the pick curve, got ${pickSug.targetValue}`);
  assert(pickSug.give.length >= 1 && pickSug.giveValue > 0, 'a give package is suggested to acquire the pick');
  console.log('✓ suggestFor values a PICK target — trade-for-a-pick is seeded with a suggestion');

  console.log('\nTRADE FIT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
