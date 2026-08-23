'use strict';

// "Waivers run soon" reminder: a couple of hours before a league's waiver run, nudge the owner that
// their pending claims are about to process (last chance to edit/reorder/drop). Covers the pure
// imminentWaiverRuns() windowing/grouping and the buildFor firing rules (exempt from priming like the
// draft clock, deduped once per run, pref honored).

const os = require('os');
const path = require('path');
const fs = require('fs');
const DIR = path.join(os.tmpdir(), `dc-waiversoon-${process.pid}`);
fs.rmSync(DIR, { recursive: true, force: true });
process.env.DATA_DIR = DIR;
process.env.MFL_DEMO_MODE = 'true';

const notifications = require('../../src/services/notifications');
const { imminentWaiverRuns, buildFor } = notifications;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const NOW = 1_700_000_000_000;
const H = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const claim = (leagueId, leagueName, atMs) => ({ leagueId, leagueName, at: atMs == null ? null : iso(atMs) });
const EMPTY = [{ drafts: [] }, { offers: [] }, { items: [] }, { alerts: [] }, { results: [] }, []];
const state = (extra = {}) => ({
  expoPushToken: 'X', prefs: {}, primed: false,
  clockLeagues: [], offerIds: [], lineupKeys: [], watchKeys: [], waiverKeys: [], clockWarnKeys: [],
  valueMoveKey: null, waiverSoonKeys: [], ...extra,
});
const build = (s, imminent) => buildFor(s, ...EMPTY, imminent);
const soonMsgs = (r) => r.msgs.filter((m) => m.data && m.data.type === 'waiver_soon');

(async () => {
  // ---- imminentWaiverRuns(): windowing + grouping ----
  assert(imminentWaiverRuns([], NOW, 3 * H).length === 0, 'no pending → no imminent runs');
  {
    const pending = [
      claim('L1', 'League One', NOW + 2 * H), claim('L1', 'League One', NOW + 2 * H), // 2 claims, same run
      claim('L2', 'League Two', NOW + 0.5 * H), // 30 min out
      claim('L3', 'League Three', NOW + 5 * H), // beyond the 3h window
      claim('L4', 'League Four', NOW - 1 * H), // already ran (past)
      claim('L5', 'League Five', null), // no run time
    ];
    const runs = imminentWaiverRuns(pending, NOW, 3 * H);
    assert(runs.length === 2, `only in-window future runs, got ${runs.length}`);
    assert(runs[0].leagueId === 'L2' && runs[1].leagueId === 'L1', 'sorted soonest-first');
    assert(runs[1].count === 2, 'claims in the same league+run are aggregated to one entry with a count');
    assert(runs[1].inMs === 2 * H, 'inMs is time-until-run');
  }
  console.log('✓ imminentWaiverRuns: window filter (past/too-far/null excluded), per-league grouping, sorted');

  const IMM = imminentWaiverRuns([claim('L1', 'League One', NOW + 2 * H), claim('L1', 'League One', NOW + 2 * H)], NOW, 3 * H);
  const KEY = `L1:${NOW + 2 * H}`;

  // ---- buildFor firing rules ----
  // Fires even when NOT primed — an imminent run is current actionable state, not backlog (like the clock).
  {
    const r = build(state({ primed: false }), IMM);
    const mm = soonMsgs(r);
    assert(mm.length === 1, `fires even unprimed, got ${mm.length}`);
    assert(/2 claims/.test(mm[0].body) && /2h/.test(mm[0].body), `body has the count + lead time, got "${mm[0].body}"`);
    assert(r.waiverSoonKeys.length === 1 && r.waiverSoonKeys[0] === KEY, 'returns the run key for dedup');
  }

  // Already reminded (state carries the run key) → no re-fire.
  assert(soonMsgs(build(state({ waiverSoonKeys: [KEY] }), IMM)).length === 0, 'same run key → no re-fire');

  // Channel off → no fire.
  assert(soonMsgs(build(state({ prefs: { waiverReminder: false } }), IMM)).length === 0, 'waiverReminder off → no push');

  // Nothing imminent → no fire, empty keys.
  {
    const r = build(state(), []);
    assert(soonMsgs(r).length === 0 && r.waiverSoonKeys.length === 0, 'no imminent runs → nothing fired');
  }

  // Two leagues imminent → one push each.
  {
    const two = imminentWaiverRuns([claim('L1', 'One', NOW + 1 * H), claim('L2', 'Two', NOW + 2 * H)], NOW, 3 * H);
    assert(soonMsgs(build(state(), two)).length === 2, 'one reminder per imminent league');
  }

  assert(notifications.DEFAULT_PREFS.waiverReminder === true, 'waiverReminder is a default-on channel');

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('✓ buildFor: reminder fires unprimed, deduped per run, pref honored, one per league');
  console.log('\nPUSH WAIVER-REMINDER HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
