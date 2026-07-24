'use strict';
// Live "Recent results" on the Pending tab: a BBID_WAIVER / WAIVER transaction for MY franchise is
// a claim that PROCESSED (the player was added) → a "won" result. This pins that liveWaiverResults
// (via getPending) reads MFL's transactions log, keeps only my franchise's waiver adds, resolves
// names, and parses the WINNING FAAB BID from the row.
//
// CONFIRMED against a live BBID_WAIVER sample: the `transaction` payload is pipe-delimited with the
// bid in the MIDDLE — "<add>,|<bid>|<drop>," (e.g. "17036,|25.00|15254," = add 17036 for $25 drop
// 15254; "16387,|258.00|" = add 16387 for $258, no drop). An FCFS WAIVER row has no bid segment:
// "<add>,|<drop>,". A LOSING bid is never written to the log (only the winner's add), so results are
// wins-only. $t-wrapped fields must parse too (transactions elements often carry attributes).
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '14080', name: 'Star, Waiver', position: 'WR', team: 'AAA' },
  { id: '15000', name: 'Pickup, Late', position: 'RB', team: 'BBB' },
  { id: '14849', name: 'Cut, Guy', position: 'TE', team: 'CCC' },
  { id: '13133', name: 'Rival, Add', position: 'WR', team: 'DDD' },
  { id: '16000', name: 'Free, Agent', position: 'RB', team: 'EEE' },
  { id: '16001', name: 'Bench, Add', position: 'WR', team: 'FFF' },
];

const t = (s) => ({ $t: String(s) }); // MFL wraps element text when the element has attributes

const TXNS = [
  // Mine, FAAB win: added 14080 for $12, dropped 14849 — REAL "add,|bid|drop," format. Newest.
  { type: t('BBID_WAIVER'), franchise: t('0001'), transaction: t('14080,|12.00|14849,'), timestamp: t('1725000300') },
  // Mine, FAAB win with NO drop and a big bid ($258) — "add,|bid,|".
  { type: 'BBID_WAIVER', franchise: '0001', transaction: '16000,|258.00|', timestamp: '1725000250' },
  // Another franchise — excluded even though it's a BBID add.
  { type: 'BBID_WAIVER', franchise: '0002', transaction: '13133,|5.00|', timestamp: '1725000200' },
  // Mine, plain FCFS WAIVER: "add,|drop," — NO bid segment. Added 16001, no drop.
  { type: 'WAIVER', franchise: '0001', transaction: '16001,|', timestamp: '1725000100' },
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
    case 'pendingWaivers':
      // A FAAB claim queued on MFL directly (NOT through the app): add 15000, bid 5, drop 14849.
      return { pendingWaivers: { blindBidWaiverRequest: { round: '1', timestamp: '1725000000', addsDrops: '15000_5_14849' } } };
    default:
      return {};
  }
};

const waivers = require('../../src/services/waivers');

(async () => {
  const { results, summary } = await waivers.getPending('ck', 'tk');
  console.log('results:', JSON.stringify(results));

  assert(results.length === 3, `only my three waiver ADDS count (got ${results.length})`);
  assert(results.every((r) => r.result === 'won'), 'a processed waiver transaction is a WON result');
  assert(results.every((r) => r.leagueName === 'Results League'), 'results carry the league name');

  // Newest first. FAAB bid parsed from the MIDDLE segment of the payload (NOT a t.bbid field).
  assert(results[0].add === 'Star, Waiver' && results[0].addId === '14080' && results[0].bid === 12, `FAAB win first: add + bid $12 from the payload middle, got ${JSON.stringify(results[0])}`);
  assert(results[0].drop === 'Cut, Guy' && results[0].dropId === '14849', `the DROPPED player (parts[2]) resolves, got ${JSON.stringify(results[0])}`);
  // No-drop FAAB with a big bid: bid parsed, drop null.
  assert(results[1].add === 'Free, Agent' && results[1].bid === 258 && results[1].drop == null, `no-drop FAAB: bid $258, no drop, got ${JSON.stringify(results[1])}`);
  // FCFS priority win: no bid segment → bid null, no drop.
  assert(results[2].add === 'Bench, Add' && results[2].bid == null && results[2].drop == null, `FCFS win: no bid, no drop, got ${JSON.stringify(results[2])}`);

  // The rival franchise's add and my TRADE are both excluded.
  assert(!results.some((r) => r.add === 'Rival, Add'), "another franchise's add is excluded");
  assert(summary.results === 3, 'summary counts the results');
  console.log('✓ live waiver results: FAAB bid parsed from the payload middle (won adds), FCFS no-bid, trades/others excluded');

  // Pending must include claims queued on MFL directly (not just app-submitted) — the reported bug.
  const { pending } = await waivers.getPending('ck', 'tk');
  const mflClaim = pending.find((p) => p.add && p.add.name === 'Pickup, Late');
  assert(mflClaim, 'a claim queued on MFL (not via the app) shows in Pending');
  assert(mflClaim.bid === 5 && mflClaim.drop && mflClaim.drop.name === 'Cut, Guy', `MFL claim carries bid + drop, got ${JSON.stringify(mflClaim)}`);
  console.log('✓ pending reconciles with MFL: an MFL-queued claim appears in the Pending tab');

  console.log('\nWAIVER RESULTS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
