'use strict';
// A throttled `league` export can come back EMPTY without throwing (a 429 body isn't valid JSON → no
// franchises). Caching that empty names map on the long static TTL would blank EVERY team name
// ("Team 0041") for the whole window — even across refreshes. franchiseNames must NOT cache an empty
// result (so a transient empty recovers on the next read) while STILL caching a populated one.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mflRepo = require('../../src/lib/mflRepo');
const leagues = require('../../src/services/leagues');

const league = { leagueId: 'L1', host: 'www10.myfantasyleague.com', franchiseId: '0001' };
const NAMED = [{ id: '0001', name: 'Team Awesome' }, { id: '0002', name: '<b>Gridiron</b> Kings' }];

(async () => {
  let mode = 'empty';
  mflRepo.leagueFranchises = async () => (mode === 'empty' ? [] : NAMED);

  // 1. A transient empty response → an empty map (teams fall back to generic), and it is NOT cached.
  let names = await leagues.franchiseNames('ck', league);
  assert(names.size === 0, 'empty league export → empty names map (teams show generic this once)');

  // 2. The very next read recovers the real names (the empty wasn't cached), HTML stripped.
  mode = 'named';
  names = await leagues.franchiseNames('ck', league);
  assert(names.get('0001') === 'Team Awesome', `recovers the real name, got ${names.get('0001')}`);
  assert(names.get('0002') === 'Gridiron Kings', 'strips HTML from a styled team name');
  console.log('✓ an empty league export is NOT cached — the next read recovers the real names');

  // 3. The populated map IS cached — a later empty response never blanks it.
  mode = 'empty';
  names = await leagues.franchiseNames('ck', league);
  assert(names.get('0001') === 'Team Awesome', 'a populated names map is cached (a later empty read never blanks it)');
  console.log('✓ a populated names map is cached (survives a subsequent empty read)');

  console.log('\nFRANCHISE-NAMES CACHE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
