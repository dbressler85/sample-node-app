'use strict';
// Counter-offers keep the incoming offer's construction but rebalance to fair value,
// and both the initial suggestion and the counter lean on each team's TRADE BAIT.
//   * suggestFor: between two equal-value givers, prefer the one I've put on my block.
//   * counterFor: an unfavorable offer is countered by asking for one MORE of their
//     players — preferring one on THEIR trade-bait board — to reach fair, same shape.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');
const baitStore = require('../../src/store/tradebait');

// Values (via FC): the target WR (20)=~; my two equal RBs; their filler + a bait RB.
const PLAYERS = [
  { id: '1', name: 'My RB Bait', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My RB Plain', position: 'RB', team: 'BBB' },
  { id: '3', name: 'My WR1', position: 'WR', team: 'CCC' },
  { id: '4', name: 'My QB1', position: 'QB', team: 'DDD' },
  { id: '20', name: 'Target WR', position: 'WR', team: 'EEE' },
  { id: '21', name: 'Their Bait RB', position: 'RB', team: 'FFF' },
  { id: '22', name: 'Their WR1', position: 'WR', team: 'GGG' },
  { id: '23', name: 'Their QB1', position: 'QB', team: 'HHH' },
];
const ROSTERS = {
  '0001': ['1', '2', '3', '4'],
  '0002': ['20', '21', '22', '23'],
};
// Their incoming offer: they give me their WR1 (22, worth 70), want my WR1 (3, worth 88)
// — unfavorable to me by ~18. Countering should ask for another of their players.
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Counter League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: {
        starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '2' }, { name: 'WR', limit: '2' }] },
        franchises: { franchise: [{ id: '0001' }, { id: '0002' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: Object.entries(ROSTERS).map(([id, ids]) => ({ id, player: ids.map((pid) => ({ id: pid, status: 'starter' })) })) } };
    case 'pendingTrades':
      return { pendingTrades: { pendingTrade: [{ trade_id: 'T1', offeringteam: '0002', offeredto: '0001', willGiveUp: '22', willReceiveInReturn: '3' }] } };
    case 'tradeBait':
      // Their board lists the RB (21) — so a counter that needs ~18 more value should
      // prefer asking for him.
      return { tradeBaits: { tradeBait: [{ franchise_id: '0002', willGiveUp: '21' }] } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '1', maybeAge: 25 }, value: 5000, overallRank: 30 }, // my RB (bait)  ~
  { player: { mflId: '2', maybeAge: 25 }, value: 5000, overallRank: 31 }, // my RB (plain) equal
  { player: { mflId: '3', maybeAge: 25 }, value: 8800, overallRank: 3 },  // my WR1 (they want)
  { player: { mflId: '4', maybeAge: 25 }, value: 9000, overallRank: 2 },
  { player: { mflId: '20', maybeAge: 25 }, value: 5000, overallRank: 32 }, // target WR
  { player: { mflId: '21', maybeAge: 25 }, value: 2000, overallRank: 120 }, // their bait RB (~deficit)
  { player: { mflId: '22', maybeAge: 25 }, value: 7000, overallRank: 10 }, // their WR1 (they give)
  { player: { mflId: '23', maybeAge: 25 }, value: 6000, overallRank: 18 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TOK = 'tok-counter';
  baitStore.remove(TOK, '1000', '1'); baitStore.remove(TOK, '1000', '2');

  // --- bait-aware initial suggestion -------------------------------------------------
  // Without bait, my two equal RBs tie; putting RB '1' on my block should break the tie.
  baitStore.add(TOK, '1000', '1', null);
  const sug = await trades.suggestFor(CK, TOK, '1000', '20', '0002');
  console.log('suggest give:', JSON.stringify(sug.give.map((g) => `${g.name} $${g.value}${g.bait ? ' [my bait]' : ''}`)));
  assert(sug.give.length === 1 && sug.give[0].id === '1', `prefers my on-the-block RB, got ${JSON.stringify(sug.give)}`);
  assert(sug.give[0].bait === true, 'suggestion flags the giver as my trade bait');
  console.log('✓ initial suggestion leans on MY trade bait (equal value → the one I’m shopping)');
  baitStore.remove(TOK, '1000', '1');

  // --- counter to an unfavorable offer ----------------------------------------------
  const ov = await trades.getOverview(CK, TOK);
  const offer = ov.offers.find((o) => o.leagueId === '1000');
  console.log('incoming:', JSON.stringify({ get: offer.analysis.acquireValue, give: offer.analysis.sendValue, verdict: offer.analysis.verdict }));
  assert(offer.analysis.verdict === 'unfavorable', 'the incoming offer is unfavorable to me');

  const c = await trades.counterFor(CK, TOK, '1000', offer.id);
  console.log('counter receive:', JSON.stringify(c.receive.map((a) => `${a.name} $${a.value}${a.bait ? ' [their bait]' : ''}`)), '=', c.receiveValue);
  console.log('counter give:', JSON.stringify(c.give.map((a) => `${a.name} $${a.value}`)), '=', c.giveValue);
  // Same construction: I still give what they asked (my WR1), still get their WR1.
  assert(c.give.length === 1 && c.give[0].id === '3', 'counter keeps giving the player they asked for');
  assert(c.receive.some((a) => a.id === '22'), 'counter keeps the player they offered');
  // Rebalanced fair-or-better, and it asked for THEIR bait RB to get there.
  assert(c.receiveValue >= c.giveValue - 1, `counter is fair-or-better for me (${c.receiveValue} vs ${c.giveValue})`);
  assert(c.receive.some((a) => a.id === '21' && a.bait === true), 'counter asks for a player on THEIR trade-bait board');
  assert(c.counterOfferId === String(offer.id), 'counter references the offer it answers');
  console.log('✓ counter keeps the shape, rebalances to fair, and leans on THEIR trade bait —', c.rationale);

  console.log('\nTRADE COUNTER HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
