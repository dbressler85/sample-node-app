'use strict';

// Value-move push channel: a notable week-over-week swing in total dynasty value, computed from the
// already-stored daily portfolio history (no MFL read). Covers the pure weeklyMove() math and the
// buildFor firing rules (primed-gated, threshold, once-per-move dedup, pref honored).

const os = require('os');
const path = require('path');
const fs = require('fs');
const DIR = path.join(os.tmpdir(), `dc-valuemove-${process.pid}`);
fs.rmSync(DIR, { recursive: true, force: true });
process.env.DATA_DIR = DIR;
process.env.MFL_DEMO_MODE = 'true';

const notifications = require('../../src/services/notifications');
const { weeklyMove, buildFor } = notifications;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const pt = (date, value) => ({ date, value });
const EMPTY = [{ drafts: [] }, { offers: [] }, { items: [] }, { alerts: [] }, { results: [] }];
const state = (extra = {}) => ({
  expoPushToken: 'X', prefs: {}, primed: true,
  clockLeagues: [], offerIds: [], lineupKeys: [], watchKeys: [], waiverKeys: [], clockWarnKeys: [],
  valueMoveKey: null, ...extra,
});
const build = (s, series) => buildFor(s, ...EMPTY, series);
const moveMsgs = (r) => r.msgs.filter((m) => m.data && m.data.type === 'value_move');

(async () => {
  // ---- weeklyMove() pure math ----
  assert(weeklyMove([]) === null && weeklyMove([pt('2026-02-09', 1000)]) === null, 'needs >= 2 points');
  assert(weeklyMove([pt('2026-02-01', 0), pt('2026-02-09', 0)]) === null, 'zero latest → null (no base to divide)');
  {
    const m = weeklyMove([pt('2026-02-01', 1000), pt('2026-02-09', 1050)]);
    assert(m && m.pct === 5 && m.absolute === 50 && m.date === '2026-02-09', `+5% week move, got ${JSON.stringify(m)}`);
  }
  {
    // Picks the newest base at least 6 days older — NOT the 4-day-old intermediate point.
    const m = weeklyMove([pt('2026-02-01', 1000), pt('2026-02-05', 1020), pt('2026-02-09', 1050)]);
    assert(m.pct === 5, `base is the >=6-day-old point (1000), so pct=5, got ${m.pct}`);
  }
  {
    const m = weeklyMove([pt('2026-02-01', 1000), pt('2026-02-09', 950)]);
    assert(m.pct === -5 && m.absolute === -50, `down move -5%, got ${JSON.stringify(m)}`);
  }
  console.log('✓ weeklyMove: <2 pts / zero-latest → null; +/- pct correct; picks the ≥6-day base');

  const UP = [pt('2026-02-01', 1000), pt('2026-02-09', 1050)]; // +5% → over the 3% bar
  const SMALL = [pt('2026-02-01', 1000), pt('2026-02-09', 1010)]; // +1% → under the bar

  // ---- buildFor firing rules ----
  // Not primed → no value-move push, even on a big swing (backlog channels prime silently first).
  assert(moveMsgs(build(state({ primed: false }), UP)).length === 0, 'not primed → no value-move push');

  // Primed + notable + new → fires exactly one, with the signed body, and returns the move key.
  {
    const r = build(state(), UP);
    const mm = moveMsgs(r);
    assert(mm.length === 1, `one value-move push on a notable new swing, got ${mm.length}`);
    assert(/\+5%/.test(mm[0].body) && /\+50/.test(mm[0].body), `body carries +5% and +50, got "${mm[0].body}"`);
    assert(r.valueMoveKey === '2026-02-09:5', `returns the move key for dedup, got ${r.valueMoveKey}`);
  }

  // Already fired (state carries the same key) → no re-fire, key preserved.
  {
    const r = build(state({ valueMoveKey: '2026-02-09:5' }), UP);
    assert(moveMsgs(r).length === 0, 'same move key → no re-fire');
    assert(r.valueMoveKey === '2026-02-09:5', 'key preserved');
  }

  // Sub-threshold move → no fire; the previous key is retained (not cleared).
  {
    const r = build(state({ valueMoveKey: '2026-01-20:9' }), SMALL);
    assert(moveMsgs(r).length === 0, 'under the 3% bar → no fire');
    assert(r.valueMoveKey === '2026-01-20:9', 'a quiet week keeps the last key, never re-fires it');
  }

  // Channel off → no fire even on a notable new swing.
  assert(moveMsgs(build(state({ prefs: { valueMove: false } }), UP)).length === 0, 'valueMove pref off → no push');

  // Down move fires with the dip title + signed-negative body.
  {
    const r = build(state(), [pt('2026-02-01', 1000), pt('2026-02-09', 950)]);
    const mm = moveMsgs(r);
    assert(mm.length === 1 && /dipped/i.test(mm[0].title) && /−50/.test(mm[0].body), `down move fires a dip, got ${JSON.stringify(mm[0])}`);
  }
  console.log('✓ buildFor: primed-gated, threshold, once-per-move dedup, pref honored, up/down bodies');

  // Channel is on by default.
  assert(notifications.DEFAULT_PREFS.valueMove === true, 'valueMove is a default-on channel');

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('\nPUSH VALUE-MOVE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
