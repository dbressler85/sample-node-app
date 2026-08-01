'use strict';
// RED-ALERT regression, part 2: the player-centric "drop across leagues" flow is one of only two writes
// that INTENTIONALLY touch multiple leagues — exactly where a loop bug could leak a write into a league
// the user never chose. This pins the invariant: a drop is issued ONLY to the leagues the user explicitly
// selected AND only where the player is actually rostered — never all leagues, never an unselected one.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-hubxl-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => '{}' });

const mfl = require('../../src/lib/mfl');
const leaguesService = require('../../src/services/leagues');
const rosterService = require('../../src/services/roster');
const waiversService = require('../../src/services/waivers');
const draftService = require('../../src/services/draft');
const playerhub = require('../../src/services/playerhub');

const CK = 'ck-hub';
const TK = 'tok-hub';
const PLAYER = '500';

// Three leagues, each its own host/franchise. The target player is rostered in A and B, NOT in C.
leaguesService.listLeagues = async () => [
  { leagueId: '1004', name: 'A', host: 'www45.myfantasyleague.com', franchiseId: '0004' },
  { leagueId: '1008', name: 'B', host: 'www10.myfantasyleague.com', franchiseId: '0008' },
  { leagueId: '1010', name: 'C', host: 'www20.myfantasyleague.com', franchiseId: '0010' },
];
const OWNED = { '1004': true, '1008': true, '1010': false };
rosterService.myRosterLight = async (cookie, leagueId) => ({
  leagueId: String(leagueId),
  starters: [], ir: [], taxi: [],
  bench: OWNED[String(leagueId)] ? [{ id: PLAYER }] : [{ id: '999' }],
});
waiversService.freeAgentIds = async () => [];
waiversService.invalidate = () => {};
draftService.freeAgencyOpen = async () => true;

// Capture every MFL write. fcfsWaiver DROP is the drop-to-FA import.
let writes = [];
mfl.importRequest = async (type, params) => { writes.push({ type, params }); return { status: 'OK' }; };

const dropHosts = () => writes.filter((w) => w.type === 'fcfsWaiver' && w.params.DROP === PLAYER).map((w) => ({ L: w.params.L, host: w.params.host }));

(async () => {
  // 1) Select A + B (both owned) → exactly two drops, each to its OWN league's L + host, none elsewhere.
  writes = [];
  const r1 = await playerhub.submitDrop(CK, TK, PLAYER, ['1004', '1008']);
  const d1 = dropHosts();
  assert(d1.length === 2, `two drops fired for the two selected+owned leagues, got ${d1.length}`);
  assert(d1.find((d) => d.L === '1004' && d.host === 'www45.myfantasyleague.com'), `drop to A carries A's L+host, got ${JSON.stringify(d1)}`);
  assert(d1.find((d) => d.L === '1008' && d.host === 'www10.myfantasyleague.com'), `drop to B carries B's L+host, got ${JSON.stringify(d1)}`);
  assert(!d1.some((d) => d.L === '1010'), 'no drop leaked into the UNSELECTED league C');
  assert(r1.summary.dropped === 2, `summary counts two drops, got ${r1.summary.dropped}`);
  console.log('✓ selecting A+B drops in A and B only, each scoped to its own L+host');

  // 2) Select ONLY A (though the player is also owned in B) → exactly one drop, to A. B is untouched.
  writes = [];
  const r2 = await playerhub.submitDrop(CK, TK, PLAYER, ['1004']);
  const d2 = dropHosts();
  assert(d2.length === 1 && d2[0].L === '1004', `selecting only A drops only in A, got ${JSON.stringify(d2)}`);
  assert(!d2.some((d) => d.L === '1008'), 'league B is NOT dropped just because the player is owned there');
  assert(r2.summary.dropped === 1, `summary counts one drop, got ${r2.summary.dropped}`);
  console.log('✓ selecting only A drops only in A — ownership elsewhere does not trigger a write');

  // 3) Select A + C, but the player is NOT on the roster in C → A drops, C is refused with NO write.
  writes = [];
  const r3 = await playerhub.submitDrop(CK, TK, PLAYER, ['1004', '1010']);
  const d3 = dropHosts();
  assert(d3.length === 1 && d3[0].L === '1004', `only the owned league A is dropped, got ${JSON.stringify(d3)}`);
  assert(!d3.some((d) => d.L === '1010'), 'the ownership guard blocks any write to C where the player is not rostered');
  const cRes = r3.results.find((x) => x.leagueId === '1010');
  assert(cRes && !cRes.ok && /not on your roster/i.test(cRes.error), `C is refused with a not-rostered reason, got ${JSON.stringify(cRes)}`);
  console.log('✓ the ownership guard blocks a write to a selected league where the player is not rostered');

  console.log('\nPLAYERHUB CROSS-LEAGUE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
