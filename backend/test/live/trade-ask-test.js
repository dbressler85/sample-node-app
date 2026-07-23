'use strict';
// Counter-ASK (trades.askFor): you pick what to SEND; it proposes a fair return to ASK FOR from
// the partner — worth ~your send value, biased to THEIR trade bait (what they'll actually move),
// YOUR needs, and your Targets. Mirror image of suggestFor. Stubs MFL to test the logic.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My RB1', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My RB2', position: 'RB', team: 'BBB' },
  { id: '3', name: 'My WR1', position: 'WR', team: 'CCC' },
  { id: '4', name: 'My QB1', position: 'QB', team: 'DDD' },
  { id: '20', name: 'Their WR2', position: 'WR', team: 'EEE' },
  { id: '21', name: 'Their Bait RB', position: 'RB', team: 'FFF' },
  { id: '22', name: 'Their WR1', position: 'WR', team: 'GGG' },
  { id: '23', name: 'Their QB1', position: 'QB', team: 'HHH' },
];
const ROSTERS = { '0001': ['1', '2', '3', '4'], '0002': ['20', '21', '22', '23'] };

mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Ask League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: {
        starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '2' }, { name: 'WR', limit: '2' }] },
        franchises: { franchise: [{ id: '0001', name: 'My Team' }, { id: '0002', name: 'Their Team' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: Object.entries(ROSTERS).map(([id, ids]) => ({ id, player: ids.map((pid) => ({ id: pid, status: 'starter' })) })) } };
    case 'tradeBait':
      // Their board lists the RB (21) — the ask should prefer including him.
      return { tradeBaits: { tradeBait: [{ franchise_id: '0002', willGiveUp: '21' }] } };
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '1', maybeAge: 25 }, value: 5000, overallRank: 30 },
  { player: { mflId: '2', maybeAge: 25 }, value: 5000, overallRank: 31 },
  { player: { mflId: '3', maybeAge: 25 }, value: 8800, overallRank: 3 }, // what I send
  { player: { mflId: '4', maybeAge: 25 }, value: 9000, overallRank: 2 },
  { player: { mflId: '20', maybeAge: 25 }, value: 5000, overallRank: 32 },
  { player: { mflId: '21', maybeAge: 25 }, value: 2000, overallRank: 120 }, // their bait RB
  { player: { mflId: '22', maybeAge: 25 }, value: 7000, overallRank: 10 }, // their WR1
  { player: { mflId: '23', maybeAge: 25 }, value: 6000, overallRank: 18 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TOK = 'tok-ask';
  // I send my WR1 (value 8800) to team 0002 → ask for a fair return from their roster.
  const r = await trades.askFor(CK, TOK, '1000', ['3'], '0002');
  console.log('send:', r.sendValue, 'ask:', JSON.stringify(r.ask.map((a) => `${a.name} $${a.value}${a.bait ? ' [their bait]' : ''}`)), 'askValue:', r.askValue, 'verdict:', r.verdict);

  assert(r.sendValue > 0, `send value computed, got ${r.sendValue}`);
  assert(r.send.length === 1 && r.send[0].id === '3', 'echoes what I send');
  assert(r.ask.length >= 1, 'proposes a return package');
  // The ask reaches ~fair value (within 15% of what I send).
  assert(Math.abs(r.askValue - r.sendValue) <= r.sendValue * 0.15, `ask ~fair, got ${r.askValue} vs ${r.sendValue}`);
  // It leans on THEIR trade bait — the RB they're shopping should be in the ask, flagged.
  const baitAsk = r.ask.find((a) => a.id === '21');
  assert(baitAsk && baitAsk.bait === true, `ask includes their on-the-block RB, flagged bait, got ${JSON.stringify(r.ask)}`);
  // Never asks for a player I'm sending, and only from their roster.
  assert(!r.ask.some((a) => a.id === '3'), 'never asks back for what I send');
  assert(r.ask.every((a) => ['20', '21', '22', '23'].includes(a.id)), 'asks only from the partner roster');
  assert(['favorable', 'fair', 'light'].includes(r.verdict), `carries a fairness verdict, got ${r.verdict}`);
  assert(r.partnerName === 'Their Team', `carries the partner name, got ${r.partnerName}`);
  console.log('✓ counter-ask: fair return from the partner, biased to their bait + my side');

  // Empty send is a clean 400.
  let threw = null;
  try { await trades.askFor(CK, TOK, '1000', [], '0002'); } catch (e) { threw = e; }
  assert(threw && threw.status === 400, 'empty send → 400');
  console.log('✓ empty send is rejected');

  console.log('\nTRADE ASK HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
