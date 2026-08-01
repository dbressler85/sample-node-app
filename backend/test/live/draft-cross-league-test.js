'use strict';
// RED-ALERT regression: a draft pick must fire in EXACTLY the league the user is picking in — never a
// second league. This reproduces the reported scenario (on the clock in two leagues at once) and pins
// the invariant end-to-end through the real makePick():
//   1. Picking in league A submits ONE live_draft write, carrying league A's L + host — never league B's.
//   2. The optimistic local pick is recorded under league A only; league B's board stays untouched.
//   3. You cannot pick in a league where it is not your turn (the on-clock-franchise guard) — and a
//      rejected attempt issues NO MFL write at all.
// If a future refactor ever let a pick cross leagues, one of these assertions fails loudly.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-draftxl-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
// Neutralize the network: the post-pick confirmation-board rebuild (makePick's internal getLeague) fans
// out other reads (players/adp/enrichment) we don't care about here. Serve benign empty payloads so it
// fail-softs instead of a 403, and no un-mocked read escapes to the allowlisted egress.
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '{}' });
const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');
const leaguesService = require('../../src/services/leagues');
const draftStore = require('../../src/store/draft');
const draft = require('../../src/services/draft');

const TK = 'tok-xl';
const CK = 'ck-xl';

// Two leagues the same owner is IN, each with its OWN host + its OWN franchise id (MFL gives a distinct
// franchise_id per league). League A = the 1.04 slot (I'm on the clock at round 1, pick 4). League B =
// the 1.08 slot (someone else is on the clock — it is NOT my turn there).
leaguesService.listLeagues = async () => [
  { leagueId: '1004', name: 'League A (1.04)', host: 'www45.myfantasyleague.com', franchiseId: '0004', franchiseName: 'My Team A' },
  { leagueId: '1008', name: 'League B (1.08)', host: 'www10.myfantasyleague.com', franchiseId: '0008', franchiseName: 'My Team B' },
];

// A minimal in-progress draft grid: three real round-1 picks already made (so the draft reads live),
// then the next OPEN slot. In A that open slot is MY franchise (0004) → I'm on the clock. In B the open
// slot is a RIVAL (0002) while my franchise there is 0008 → not my turn.
const past = Math.floor(Date.now() / 1000) - 600;
function grid(openFranchise) {
  return [{
    unit: 'LEAGUE', draftType: 'snake', startTime: String(Math.floor(Date.now() / 1000) - 3600),
    draftPick: [
      { round: '1', pick: '1', franchise: '0001', player: '100', timestamp: String(past) },
      { round: '1', pick: '2', franchise: '0002', player: '101', timestamp: String(past) },
      { round: '1', pick: '3', franchise: '0003', player: '102', timestamp: String(past) },
      { round: '1', pick: '4', franchise: openFranchise, player: '', timestamp: '' },
      { round: '1', pick: '5', franchise: '0005', player: '', timestamp: '' },
    ],
  }];
}
mflRepo.draftResults = async (league) => (String(league.leagueId) === '1004' ? grid('0004') : grid('0002'));
mflRepo.calendar = async () => []; // → draftStartMs returns null; start comes from the grid's past startTime

// Capture every live_draft write. Return MFL's OK marker so makePick treats the pick as accepted.
const writes = [];
mfl.miscRequest = async (type, params) => { writes.push({ type, params }); return { status: 'OK' }; };
// Neutralize the confirmation-board rebuild (heavy fan-out) — makePick tolerates it throwing and returns
// its lightweight success sentinel, which is all we assert on. Force that path so no real network is hit.
draft.getLeague = async () => { throw new Error('board rebuild stubbed'); };

(async () => {
  // 1) Pick in LEAGUE A (my clock). Exactly one write, and it carries A's L + host — not B's.
  const res = await draft.makePick(CK, TK, '1004', '200');
  assert(writes.length === 1, `exactly one live_draft write fired, got ${writes.length}`);
  const w = writes[0].params;
  assert(writes[0].type === 'live_draft' && w.CMD === 'DRAFT', 'the write is a live_draft DRAFT command');
  assert(w.L === '1004', `the write targets league A (L=1004), got L=${w.L}`);
  assert(w.host === 'www45.myfantasyleague.com', `the write uses league A's host, got ${w.host}`);
  assert(w.PLAYER_PICK === '200' && Number(w.ROUND) === 1 && Number(w.PICK) === 4, `player/round/pick match my on-clock slot, got ${JSON.stringify({ p: w.PLAYER_PICK, r: w.ROUND, k: w.PICK })}`);
  // makePick returns either the rebuilt board or a lightweight sentinel — both carry league A's id, and
  // either way the pick is reflected (sentinel.picked, or the board showing player 200 on my slot).
  const reflected = res && String(res.leagueId) === '1004' && (res.picked || (res.myPicks || []).some((p) => p.playerId === '200'));
  assert(reflected, `makePick reports success for league A, got ${JSON.stringify(res).slice(0, 120)}`);
  console.log('✓ picking in league A submits ONE write, scoped to A (L=1004, A\'s host)');

  // 2) The optimistic pick is recorded under A only — league B's board is untouched (no phantom pick).
  const aPicks = draftStore.list(TK, '1004', []);
  const bPicks = draftStore.list(TK, '1008', []);
  assert(aPicks.some((p) => p.playerId === '200'), `league A records the pick, got ${JSON.stringify(aPicks)}`);
  assert(bPicks.length === 0, `league B records NOTHING — no cross-league phantom pick, got ${JSON.stringify(bPicks)}`);
  console.log('✓ the pick is recorded under league A only; league B\'s board stays empty');

  // 3) You cannot pick in league B — it is not your turn there — and NO write is issued for it.
  let threw = null;
  try { await draft.makePick(CK, TK, '1008', '201'); } catch (e) { threw = e; }
  assert(threw && /not your pick/i.test(threw.message), `picking out of turn in B is rejected, got ${threw && threw.message}`);
  assert(writes.length === 1, `the rejected B attempt issued NO MFL write (still 1 total), got ${writes.length}`);
  assert(draftStore.list(TK, '1008', []).length === 0, 'league B still records nothing after the rejected attempt');
  console.log('✓ picking out of turn in league B is rejected with no MFL write');

  console.log('\nDRAFT CROSS-LEAGUE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
