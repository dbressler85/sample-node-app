'use strict';
// Full-deal generator (trades.fullDealFor): from zero with a partner, propose BOTH sides — acquire
// their surplus/bait player at YOUR need, pay with your surplus/bait at THEIR need, at fair value.
// Setup: I'm deep at WR / thin at RB; the partner is the mirror. The deal should send a WR for an RB.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My QB', position: 'QB', team: 'AAA' },
  { id: '2', name: 'My RB', position: 'RB', team: 'BBB' },
  { id: '3', name: 'My WR Block', position: 'WR', team: 'CCC' },
  { id: '4', name: 'My WR2', position: 'WR', team: 'DDD' },
  { id: '5', name: 'My WR3', position: 'WR', team: 'EEE' },
  { id: '10', name: 'Their QB', position: 'QB', team: 'FFF' },
  { id: '11', name: 'Their RB Block', position: 'RB', team: 'GGG' },
  { id: '12', name: 'Their RB2', position: 'RB', team: 'HHH' },
  { id: '13', name: 'Their RB3', position: 'RB', team: 'III' },
  { id: '14', name: 'Their WR', position: 'WR', team: 'JJJ' },
];
// Me: 1 RB, 3 WR → need RB, surplus WR. Them: 3 RB, 1 WR → need WR, surplus RB.
const ROSTERS = { '0001': ['1', '2', '3', '4', '5'], '0002': ['10', '11', '12', '13', '14'] };

mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Deal League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
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
      // I'm shopping my WR (3); they're shopping their RB (11) — the deal should use both.
      return { tradeBaits: { tradeBait: [{ franchise_id: '0001', willGiveUp: '3' }, { franchise_id: '0002', willGiveUp: '11' }] } };
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '1', maybeAge: 25 }, value: 5000, overallRank: 40 },
  { player: { mflId: '2', maybeAge: 25 }, value: 4000, overallRank: 60 },
  { player: { mflId: '3', maybeAge: 25 }, value: 6000, overallRank: 20 }, // my WR on the block
  { player: { mflId: '4', maybeAge: 25 }, value: 5500, overallRank: 25 },
  { player: { mflId: '5', maybeAge: 25 }, value: 3000, overallRank: 90 },
  { player: { mflId: '10', maybeAge: 25 }, value: 5000, overallRank: 41 },
  { player: { mflId: '11', maybeAge: 25 }, value: 6000, overallRank: 21 }, // their RB on the block ≈ my WR
  { player: { mflId: '12', maybeAge: 25 }, value: 4500, overallRank: 50 },
  { player: { mflId: '13', maybeAge: 25 }, value: 3000, overallRank: 91 },
  { player: { mflId: '14', maybeAge: 25 }, value: 5000, overallRank: 42 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const d = await trades.fullDealFor('ck', 'tok-deal', '1000', '0002');
  console.log('deal:', JSON.stringify({
    receive: d.receive.map((a) => `${a.name} $${a.value}${a.bait ? ' [their block]' : ''}`),
    send: d.send.map((a) => `${a.name} $${a.value}${a.bait ? ' [my block]' : ''}`),
    verdict: d.verdict, rationale: d.rationale,
  }));

  // Acquires their on-the-block RB (fills my RB need), flagged as their bait.
  assert(d.receive.length === 1 && d.receive[0].id === '11' && d.receive[0].bait === true, `acquires their block RB, got ${JSON.stringify(d.receive)}`);
  // Pays with my on-the-block WR (fills their WR need), flagged as my bait.
  assert(d.send.some((a) => a.id === '3' && a.bait === true), `sends my block WR, got ${JSON.stringify(d.send)}`);
  assert(d.send.every((a) => a.position !== 'RB'), 'never sends from my thin RB spot');
  // Fair by value.
  assert(Math.abs(d.receiveValue - d.sendValue) <= Math.max(d.receiveValue, d.sendValue) * 0.15, `deal ~fair, got ${d.receiveValue} vs ${d.sendValue}`);
  assert(['favorable', 'fair', 'light'].includes(d.verdict), `carries a verdict, got ${d.verdict}`);
  // Rationale names both sides of the fit.
  assert(/need/i.test(d.rationale) && /block/i.test(d.rationale), `rationale explains the fit, got "${d.rationale}"`);
  assert(d.partnerName === 'Their Team', `carries partner name, got ${d.partnerName}`);
  assert(typeof d.format === 'string' && d.format.length > 0, 'carries a league format label');
  console.log('✓ full deal: their block RB (my need) for my block WR (their need), fair value');

  // Unknown partner is a clean 404.
  let threw = null;
  try { await trades.fullDealFor('ck', 'tok-deal', '1000', '9999'); } catch (e) { threw = e; }
  assert(threw && threw.status === 404, 'unknown partner → 404');
  console.log('✓ unknown partner is rejected');

  console.log('\nTRADE DEAL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
