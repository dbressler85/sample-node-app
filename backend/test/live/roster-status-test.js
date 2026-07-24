'use strict';
// Roster-slot bucketing from the `rosters` export `status` field (roster-status pass). MFL is
// inconsistent across exports about the tokens — the rosters export uses the long forms
// INJURED_RESERVE / TAXI_SQUAD (+ lowercase `starter` for a set lineup), the sibling
// playerRosterStatus export uses short codes IR / TS. We can't confirm which the rosters export
// returns offseason (no IR/taxi players), so bucketPlayers accepts BOTH. This pins that: a misread
// would silently dump IR/taxi players into `bench` and suppress the illegal-IR alert.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');

mfl.exportRequest = async (type) => {
  if (type === 'myleagues') {
    return { leagues: { league: [{ league_id: 'L1', name: 'Status League', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001' }] } };
  }
  return {};
};

const roster = require('../../src/services/roster');

async function bucketsFor(players) {
  // Stub the normalized rosters read for THIS scenario (one franchise, my id).
  mflRepo.rosters = async () => [{ id: '0001', player: players }];
  const r = await roster.myRosterLight('ck', 'L1');
  const ids = (arr) => (arr || []).map((p) => p.id);
  return { starters: ids(r.starters), bench: ids(r.bench), ir: ids(r.ir), taxi: ids(r.taxi) };
}

(async () => {
  // 1) Long-form tokens (what our code originally assumed).
  let b = await bucketsFor([
    { id: '10', status: 'starter' },
    { id: '11', status: 'nonstarter' },
    { id: '12', status: 'INJURED_RESERVE' },
    { id: '13', status: 'TAXI_SQUAD' },
  ]);
  assert(b.starters.join() === '10', `long: starter → starters, got ${JSON.stringify(b)}`);
  assert(b.bench.join() === '11', 'long: nonstarter → bench');
  assert(b.ir.join() === '12', 'long: INJURED_RESERVE → ir');
  assert(b.taxi.join() === '13', 'long: TAXI_SQUAD → taxi');
  console.log('✓ long forms: starter / INJURED_RESERVE / TAXI_SQUAD bucket correctly');

  // 2) Short codes (what the sibling export uses) — must bucket the same, not fall to bench.
  b = await bucketsFor([
    { id: '20', status: 'IR' },
    { id: '21', status: 'TS' },
    { id: '22', status: 'ROSTER' }, // a plain active player
  ]);
  assert(b.ir.join() === '20', `short: IR → ir, got ${JSON.stringify(b)}`);
  assert(b.taxi.join() === '21', 'short: TS → taxi');
  assert(b.bench.join() === '22', 'short: ROSTER → bench');
  console.log('✓ short codes: IR / TS bucket like their long forms (no silent fall-through to bench)');

  // 3) Case/whitespace tolerance + the legacy `roster_status` field.
  b = await bucketsFor([
    { id: '30', status: ' injured_reserve ' },
    { id: '31', roster_status: 'taxi_squad' },
    { id: '32', status: 'Starter' },
  ]);
  assert(b.ir.join() === '30' && b.taxi.join() === '31' && b.starters.join() === '32', `case/space/roster_status handled, got ${JSON.stringify(b)}`);
  console.log('✓ case-insensitive, trims, honors legacy roster_status');

  // 4) A normal status can't false-positive into IR/taxi (exact-token match, no substring).
  b = await bucketsFor([{ id: '40', status: 'RESERVE_LIST_MAYBE' }, { id: '41', status: 'TSX' }]);
  assert(b.bench.join() === '40,41' && !b.ir.length && !b.taxi.length, `no substring false-positives, got ${JSON.stringify(b)}`);
  console.log('✓ exact-token match: IR/TS substrings don’t false-positive');

  console.log('\nROSTER STATUS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
