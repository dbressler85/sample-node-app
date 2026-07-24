'use strict';
// Outbid (LOST) blind-bid detection. MFL never logs a losing bid, so we snapshot our MFL-queued bids
// (pendingWaivers — covers site + app) on each view; when a bid later vanishes from the pending set
// the run took it, and if the player isn't in our WINS we were outbid. This drives getPending twice
// (before/after a run) and asserts the loss surfaces as a 'lost' result with the bid, while a bid
// that WON does not.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-lostbids-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');
const leaguesService = require('../../src/services/leagues');

const PLAYERS = [
  { id: '14080', name: 'Bid, Target', position: 'WR', team: 'AAA' },
  { id: '14849', name: 'Drop, Guy', position: 'TE', team: 'BBB' },
  { id: '15000', name: 'Won, Player', position: 'RB', team: 'CCC' },
];
mfl.exportRequest = async (type) => (type === 'players' ? { players: { player: PLAYERS } } : {});
leaguesService.listLeagues = async () => [{ leagueId: '1000', name: 'Bid League', host: 'www45.myfantasyleague.com', franchiseId: '0001' }];

// Mutable MFL state the stubbed repo returns; changed between "views".
const state = { pending: [], txns: [] };
mflRepo.pendingWaivers = async () => state.pending; // normalized: [{ system, round, picks:[{add,bid,drop}] }]
mflRepo.transactions = async () => state.txns; // raw txn rows
mflRepo.calendar = async () => [];

const waivers = require('../../src/services/waivers');
const CK = 'ck', TK = 'tk';
const lostRows = (res) => res.results.filter((r) => r.result === 'lost');

(async () => {
  // VIEW 1 — a bid is queued on MFL ($12 on 14080, dropping 14849). Snapshot records it; no result yet.
  state.pending = [{ system: 'faab', round: 1, picks: [{ add: '14080', bid: 12, drop: '14849' }] }];
  state.txns = [];
  let res = await waivers.getPending(CK, TK);
  assert(res.pending.some((p) => p.add && p.add.id === '14080'), 'view 1: the queued bid shows as pending');
  assert(lostRows(res).length === 0, 'view 1: nothing lost yet (bid still pending)');
  console.log('✓ view 1: queued bid snapshotted, shown pending, no loss yet');

  // VIEW 2 — the run processed: the bid is GONE from MFL pending, and 14080 is NOT in our wins → outbid.
  state.pending = [];
  state.txns = []; // no win for 14080 (someone else got him)
  res = await waivers.getPending(CK, TK);
  const lost = lostRows(res);
  assert(lost.length === 1, `view 2: one outbid loss surfaces, got ${lost.length}`);
  assert(lost[0].addId === '14080' && lost[0].add === 'Bid, Target' && lost[0].bid === 12, `loss carries the player + our $12 bid, got ${JSON.stringify(lost[0])}`);
  assert(lost[0].drop === 'Drop, Guy', 'loss carries the would-be drop');
  assert(!res.pending.some((p) => p.add && p.add.id === '14080'), 'view 2: the settled bid no longer shows as pending');
  console.log('✓ view 2: bid vanished from MFL pending + not won → surfaced as a $12 OUTBID loss');

  // VIEW 3 (idempotent) — reloading doesn't duplicate the loss or resurrect it as pending.
  res = await waivers.getPending(CK, TK);
  assert(lostRows(res).length === 1, 're-load keeps exactly one loss (no duplication)');
  console.log('✓ view 3: reload is idempotent (one loss, still no pending)');

  // WON path — a fresh league/token: bid queued, then it WINS (in transactions) → NOT a loss.
  const TK2 = 'tk2';
  state.pending = [{ system: 'faab', round: 1, picks: [{ add: '15000', bid: 5, drop: null }] }];
  state.txns = [];
  await waivers.getPending(CK, TK2); // snapshot the bid
  state.pending = []; // run processed
  state.txns = [{ type: 'BBID_WAIVER', franchise: '0001', transaction: '15000,|5.00|', timestamp: '1781110800' }]; // we WON 15000
  res = await waivers.getPending(CK, TK2);
  assert(lostRows(res).length === 0, 'won bid is NOT a loss');
  assert(res.results.some((r) => r.result === 'won' && r.addId === '15000' && r.bid === 5), 'the win shows (from transactions) with its bid');
  console.log('✓ won path: a bid that cleared AND appears in wins is a win, not a loss');

  console.log('\nWAIVER LOST-BIDS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
