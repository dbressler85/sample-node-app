'use strict';

// League switcher / pin. Covers the pin pref end-to-end over the store and the ordering
// surface:
//   - leaguePrefs store: setPin toggles a durable per-owner flag
//   - leaguesService.orderedLeagues: pinned leagues sort first, the flag is annotated, and
//     nothing is ever dropped — every league the account is in is always present.
// Demo mode supplies the three demo leagues.

process.env.MFL_DEMO_MODE = 'true';

const leaguePrefs = require('../../src/store/leaguePrefs');
const leaguesService = require('../../src/services/leagues');

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// Demo league ids.
const A = '64097'; // left alone
const B = '40750'; // left alone
const C = '19622'; // pinned
const TOKEN = 'league-prefs-test-token';

(async () => {
  // Clean slate for this token.
  for (const id of [A, B, C]) leaguePrefs.setPin(TOKEN, id, false);

  // 1) setPin sets and clears a durable flag.
  leaguePrefs.setPin(TOKEN, A, true);
  assert(leaguePrefs.get(TOKEN).pinned.includes(A), 'pin sets');
  leaguePrefs.setPin(TOKEN, A, false);
  assert(!leaguePrefs.get(TOKEN).pinned.includes(A), 'pin clears');

  // 2) orderedLeagues: pinned first, flag annotated, every league present.
  leaguePrefs.setPin(TOKEN, C, true);
  const ordered = await leaguesService.orderedLeagues('ck', TOKEN);
  console.log('ordered:', ordered.map((l) => `${l.leagueId}${l.pinned ? '★' : ''}`).join(' '));
  assert(ordered.length === 3, 'all leagues present');
  assert(ordered[0].leagueId === C && ordered[0].pinned === true, 'pinned league sorts to the top');
  assert(ordered.find((l) => l.leagueId === A).pinned === false, 'unpinned league carries pinned:false');

  // Cleanup this token so a debounced disk write can't leak into other suites.
  for (const id of [A, B, C]) leaguePrefs.setPin(TOKEN, id, false);

  console.log('✓ pin sorts to top; every league always present; setPin durable');
  console.log('\nLEAGUE PREFS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
