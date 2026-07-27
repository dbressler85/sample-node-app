'use strict';
// Exposure honesty (the "owned in 8/8 when I'm in 15" trust bug, applied to My Players): a throttled
// per-league roster read must NOT silently vanish from the cross-league counts. The fan-out retries a
// transient failure and, when a league still can't be read, the response reports leaguesLoaded of
// leaguesTotal + a `partial` flag — and the exposure % is over the leagues we actually measured, not
// deflated against the full total. Stubs the sub-services so it tests the aggregation, not MFL.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '5';

const nflLib = require('../../src/lib/nfl');
const leaguesService = require('../../src/services/leagues');
const rosterService = require('../../src/services/roster');
const pointsMaps = require('../../src/lib/pointsMaps');

nflLib.currentWeek = async () => 5;
leaguesService.orderedLeagues = async () => [
  { leagueId: 'L1', name: 'League One' },
  { leagueId: 'L2', name: 'League Two' },
  { leagueId: 'L3', name: 'League Three' },
];
// A player rostered in L1 + L2. L3's read always throws → the league drops, honestly (partial flags).
// (The transient-throttle RETRY now lives at the source, lib/mflRepo.rosters — covered by
// mflrepo-rosters-retry-test — so this stub at the service level intentionally sees one attempt.)
const star = { id: '11', name: 'Bravo Wideout', position: 'WR', team: 'BBB', age: 25, value: 8000, availability: { status: 'ACTIVE' } };
const rosterFor = () => ({ starters: [star], bench: [], ir: [], taxi: [] });
rosterService.myRosterEnriched = async (cookie, leagueId) => {
  if (leagueId === 'L3') { throw new Error('MFL 429'); }
  return rosterFor();
};
pointsMaps.maps = async () => ({ season: new Map(), proj: new Map() });

const exposure = require('../../src/services/exposure');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const r = await exposure.getExposure('ck', 'tk');

  // Honesty flags: 2 of 3 leagues loaded → partial.
  assert(r.leaguesTotal === 3, `leaguesTotal is the TRUE league count, got ${r.leaguesTotal}`);
  assert(r.leaguesLoaded === 2, `leaguesLoaded counts only the leagues we could read, got ${r.leaguesLoaded}`);
  assert(r.partial === true, 'partial is set when a league dropped');
  console.log(`✓ exposure reports ${r.leaguesLoaded} of ${r.leaguesTotal} leagues loaded (partial=${r.partial})`);

  // The % is over what we measured (2), not deflated against the full total (3) — the player we roster
  // in both readable leagues reads 100%, framed by the partial flag, instead of a misleading 67%.
  const p = r.players.find((x) => x.id === '11');
  assert(p && p.count === 2, `player counts the leagues he's rostered in, got ${p && p.count}`);
  assert(p.exposurePct === 100, `exposure % is over the leagues loaded (2), got ${p.exposurePct}`);
  console.log(`✓ exposure % is honest over measured leagues (Bravo = ${p.exposurePct}% of ${r.leaguesLoaded})`);

  console.log('\nEXPOSURE PARTIAL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
