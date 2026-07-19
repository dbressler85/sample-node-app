'use strict';
// Verify the live NFL week is auto-detected from MFL (not a hand-set env var),
// that an explicit MFL_WEEK still overrides, and that the detected week drives
// real injury/bye maps — so in live mode players are correctly gated instead of
// all showing ACTIVE. Covers audit items #1–#3.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK; // force auto-detection

const mfl = require('../../src/lib/mfl');
const nflLib = require('../../src/lib/nfl');
const availability = require('../../src/lib/availability');

// Teams AAA & BBB play this week; CCC is idle -> on bye.
const PLAYERS = [
  { id: '1', name: 'Active WR', position: 'WR', team: 'AAA' },
  { id: '2', name: 'Hurt RB', position: 'RB', team: 'BBB' },
  { id: '3', name: 'Bye TE', position: 'TE', team: 'CCC' },
];
let nflScheduleCalls = 0;
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'nflSchedule':
      // Called WITHOUT a week to detect the current one; WITH a week for byes.
      if (opts.W == null) {
        nflScheduleCalls += 1;
        return { nflSchedule: { week: '7', matchup: [{ team: [{ id: 'AAA' }, { id: 'BBB' }] }] } };
      }
      return { nflSchedule: { week: String(opts.W), matchup: [{ team: [{ id: 'AAA' }, { id: 'BBB' }] }] } };
    case 'injuries':
      return { injuries: { injury: [{ id: '2', status: 'OUT' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    default:
      return {};
  }
};

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck';

  // 1) Auto-detect the week from MFL.
  nflLib._resetWeekCache();
  const w = await nflLib.currentWeek(CK);
  console.log('detected week:', w);
  assert(w === 7, `auto-detected week should be 7, got ${w}`);

  // Cached: a second call must not refetch.
  const before = nflScheduleCalls;
  await nflLib.currentWeek(CK);
  assert(nflScheduleCalls === before, 'second currentWeek should hit the cache, not refetch');
  console.log('✓ week auto-detected from MFL nflSchedule and cached');

  // 2) An explicit env override wins (and short-circuits the fetch).
  process.env.MFL_WEEK = '12';
  nflLib._resetWeekCache();
  const forced = await nflLib.currentWeek(CK);
  assert(forced === 12, `MFL_WEEK override should win, got ${forced}`);
  delete process.env.MFL_WEEK;
  nflLib._resetWeekCache();
  console.log('✓ MFL_WEEK override respected');

  // 3) The detected week drives real injury + bye maps, which gate availability.
  const week = await nflLib.currentWeek(CK);
  const [statusMap, byeMap] = await Promise.all([nflLib.injuryMap(CK, week), nflLib.byeMap(CK, week)]);
  assert(statusMap['2'] === 'OUT', 'injury map should mark player 2 OUT');
  assert(byeMap['CCC'] === 7, 'bye map should flag idle team CCC on bye');

  const active = availability.resolve(PLAYERS[0], statusMap, byeMap, week);
  const hurt = availability.resolve(PLAYERS[1], statusMap, byeMap, week);
  const bye = availability.resolve(PLAYERS[2], statusMap, byeMap, week);
  assert(active.startable, 'healthy player should be startable');
  assert(!hurt.startable && hurt.status === 'OUT', 'OUT player should not be startable');
  assert(!bye.startable && bye.status === 'BYE', 'bye player should not be startable');
  console.log('✓ live injury/bye maps populated → players gated (not all ACTIVE)');

  console.log('\nWEEK-DETECT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
