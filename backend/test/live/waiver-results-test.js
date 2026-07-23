'use strict';
// Live "Recent results" on the Pending tab: a BBID_WAIVER / WAIVER transaction for MY franchise is
// a claim that PROCESSED (the player was added) → a "won" result. This pins that liveWaiverResults
// (via getPending) reads MFL's transactions log, keeps only my franchise's waiver adds, resolves
// names, surfaces a NAMED bid when present, and ignores trades/other franchises. $t-wrapped fields
// must parse too (transactions elements often carry attributes).
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '14080', name: 'Star, Waiver', position: 'WR', team: 'AAA' },
  { id: '15000', name: 'Pickup, Late', position: 'RB', team: 'BBB' },
  { id: '14849', name: 'Cut, Guy', position: 'TE', team: 'CCC' },
  { id: '13133', name: 'Rival, Add', position: 'WR', team: 'DDD' },
];

const t = (s) => ({ $t: String(s) }); // MFL wraps element text when the element has attributes

const TXNS = [
  // Mine, FAAB win with a named bid — newest.
  { type: t('BBID_WAIVER'), franchise: t('0001'), transaction: t('14080,|14849,'), timestamp: t('1725000300'), bbid: t('12') },
  // Another franchise — excluded.
  { type: 'BBID_WAIVER', franchise: '0002', transaction: '13133,|', timestamp: '1725000200' },
  // Mine, plain WAIVER (priority) with no bid.
  { type: 'WAIVER', franchise: '0001', transaction: '15000,|', timestamp: '1725000100' },
  // Mine, but a TRADE — not a waiver result.
  { type: 'TRADE', franchise: '0001', transaction: '14080,|13133,|0002', timestamp: '1725000050' },
];

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Results League', url: 'https://www49.myfantasyleague.com/2026/home/1000', franchise_id: '0001' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'transactions':
      // The service should filter to waiver types via TRANS_TYPE; return the mixed set to prove
      // our own type/franchise filtering holds even if MFL returns extra rows.
      return { transactions: { transaction: TXNS } };
    default:
      return {};
  }
};

const waivers = require('../../src/services/waivers');

(async () => {
  const { results, summary } = await waivers.getPending('ck', 'tk');
  console.log('results:', JSON.stringify(results));

  assert(results.length === 2, `only my two waiver ADDS count (got ${results.length})`);
  assert(results.every((r) => r.result === 'won'), 'a processed waiver transaction is a WON result');
  assert(results.every((r) => r.leagueName === 'Results League'), 'results carry the league name');

  // Newest first: the FAAB win (ts 300) before the priority win (ts 100).
  assert(results[0].add === 'Star, Waiver' && results[0].bid === 12, `FAAB win first with named bid, got ${JSON.stringify(results[0])}`);
  assert(results[1].add === 'Pickup, Late' && results[1].bid == null, 'priority win has no bid');

  // The rival franchise's add and my TRADE are both excluded.
  assert(!results.some((r) => r.add === 'Rival, Add'), "another franchise's add is excluded");
  assert(summary.results === 2, 'summary counts the results');
  console.log('✓ live waiver results: my won adds only, $t-parsed, named bid surfaced, trades/others excluded');

  console.log('\nWAIVER RESULTS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
