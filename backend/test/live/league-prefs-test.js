'use strict';

// League switcher / pin / mute (PO backlog). Covers the whole feature end-to-end
// over the store + the three surfaces muting is meant to touch:
//   - leaguePrefs store: pin & mute are mutually exclusive (setting one clears the other)
//   - leaguesService.orderedLeagues: pinned sort first; `hideMuted` drops muted leagues
//   - On Deck: items from muted leagues are filtered out
//   - exposure: muted leagues never enter the cross-league roll-up
// Demo mode supplies the three demo leagues; the On Deck / exposure sub-services are
// stubbed so we test the pref plumbing, not MFL.

process.env.MFL_DEMO_MODE = 'true';

const leaguePrefs = require('../../src/store/leaguePrefs');
const leaguesService = require('../../src/services/leagues');
const rosterService = require('../../src/services/roster');
const draftService = require('../../src/services/draft');
const lineupsService = require('../../src/services/lineups');
const waiversService = require('../../src/services/waivers');

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// Demo league ids.
const A = '64097'; // left alone
const B = '40750'; // muted
const C = '19622'; // pinned
const TOKEN = 'league-prefs-test-token';

(async () => {
  // Clean slate for this token.
  for (const id of [A, B, C]) { leaguePrefs.setPin(TOKEN, id, false); leaguePrefs.setMute(TOKEN, id, false); }

  // 1) Pin & mute are mutually exclusive.
  leaguePrefs.setPin(TOKEN, A, true);
  assert(leaguePrefs.get(TOKEN).pinned.includes(A), 'pin sets');
  leaguePrefs.setMute(TOKEN, A, true);
  let pf = leaguePrefs.get(TOKEN);
  assert(pf.muted.includes(A) && !pf.pinned.includes(A), 'muting an already-pinned league un-pins it');
  leaguePrefs.setPin(TOKEN, A, true);
  pf = leaguePrefs.get(TOKEN);
  assert(pf.pinned.includes(A) && !pf.muted.includes(A), 'pinning an already-muted league un-mutes it');
  leaguePrefs.setPin(TOKEN, A, false); // reset A to neutral
  assert(!leaguePrefs.get(TOKEN).pinned.includes(A) && !leaguePrefs.get(TOKEN).muted.includes(A), 'A is neutral again');

  // Final state for the ordering/surface tests: C pinned, B muted, A neutral.
  leaguePrefs.setPin(TOKEN, C, true);
  leaguePrefs.setMute(TOKEN, B, true);

  // 2) orderedLeagues: pinned first, flags annotated, nothing dropped without hideMuted.
  const ordered = await leaguesService.orderedLeagues('ck', TOKEN);
  console.log('ordered:', ordered.map((l) => `${l.leagueId}${l.pinned ? '★' : ''}${l.muted ? '🔕' : ''}`).join(' '));
  assert(ordered.length === 3, 'all leagues present without hideMuted');
  assert(ordered[0].leagueId === C && ordered[0].pinned === true, 'pinned league sorts to the top');
  assert(ordered.find((l) => l.leagueId === B).muted === true, 'muted flag is annotated');
  assert(ordered.find((l) => l.leagueId === A).pinned === false && ordered.find((l) => l.leagueId === A).muted === false, 'neutral league carries both flags false');

  // 3) hideMuted drops muted leagues but keeps pin order.
  const active = await leaguesService.orderedLeagues('ck', TOKEN, { hideMuted: true });
  assert(active.length === 2 && !active.find((l) => l.leagueId === B), 'hideMuted drops the muted league');
  assert(active[0].leagueId === C, 'hideMuted preserves pinned-first order');

  // 4) On Deck filters items from muted leagues. Stub the three sub-services to emit a
  //    draft-clock item for the pinned league (C, visible) and the muted league (B).
  draftService.getOverview = async () => ({
    drafts: [
      { leagueId: C, name: 'Pinned League', myOnClock: true, type: 'Rookie draft' },
      { leagueId: B, name: 'Muted League', myOnClock: true, type: 'Rookie draft' },
    ],
  });
  lineupsService.getOverview = async () => ({ leagues: [] });
  waiversService.getPending = async () => ({ pending: [] });
  const ondeck = require('../../src/services/ondeck');
  const deck = await ondeck.getOnDeck('ck', TOKEN);
  const deckLeagues = deck.items.map((i) => i.leagueId);
  console.log('on deck leagues:', JSON.stringify(deckLeagues));
  assert(deckLeagues.includes(C), 'On Deck keeps the visible (pinned) league');
  assert(!deckLeagues.includes(B), 'On Deck drops the muted league');
  assert(deck.summary.total === deck.items.length, 'On Deck summary counts only visible items');

  // 5) Exposure never rolls up a muted league. Stub rosters so each league contributes
  //    one uniquely-named player; the muted league's player must be absent.
  const mk = (id, name) => ({ starters: [{ id, name, position: 'WR', team: 'X', age: 25, value: 50, availability: 'ok' }], bench: [], ir: [], taxi: [] });
  const rosters = { [A]: mk('pA', 'Player A'), [B]: mk('pB', 'Player B'), [C]: mk('pC', 'Player C') };
  rosterService.getRoster = async (cookie, leagueId) => rosters[String(leagueId)] || mk('p?', '?');
  const exposure = require('../../src/services/exposure');
  const exp = await exposure.getExposure('ck', TOKEN);
  const names = exp.players.map((p) => p.name);
  console.log('exposure players:', JSON.stringify(names), 'totalLeagues:', exp.totalLeagues);
  assert(exp.totalLeagues === 2, 'exposure totalLeagues excludes the muted league');
  assert(names.includes('Player C') && names.includes('Player A'), 'exposure includes visible leagues');
  assert(!names.includes('Player B'), 'exposure excludes the muted league');

  // Cleanup this token so a debounced disk write can't leak into other suites.
  for (const id of [A, B, C]) { leaguePrefs.setPin(TOKEN, id, false); leaguePrefs.setMute(TOKEN, id, false); }

  console.log('✓ pin sorts to top; mute drops from ordered(hideMuted), On Deck, and exposure; pin/mute mutually exclusive');
  console.log('\nLEAGUE PREFS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
