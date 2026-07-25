'use strict';

// Draft pick-clock math. MFL gives us WHEN the last pick was made (the `timestamp` on each
// draftResults pick) but NOT the pick-clock length or the nightly pause window (those are commissioner
// settings MFL doesn't export). So the countdown = lastPickAt + pickHours, computed against a
// pause-aware clock: time only "runs" outside the nightly pause window, so an overnight pause pushes
// the deadline out by the paused duration and the countdown reads "paused" while we're inside it.
//
// Pure + deterministic (all inputs are numbers/config), so it's fully unit-testable. The one external
// fact is "what ET hour is this instant" — resolved via Intl so it's correct across EDT/EST.

const HOUR = 3600 * 1000;
const STEP = 5 * 60 * 1000; // integration granularity — a human countdown doesn't need sub-5-min precision
const MAX_STEPS = 3000; // safety cap (~10 days of stepping) so a bad config can't spin forever

// ET hour-of-day (0–23.999) for an instant, DST-correct.
function etHour(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ms));
  let h = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  if (h === 24) h = 0;
  const m = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  return h + m / 60;
}

// Is `ms` inside the nightly pause window? `pause` = { start, end } in ET hours (e.g. {start:0,end:8}
// for midnight–8am, or {start:23,end:7} which wraps midnight). Null / equal bounds = never paused.
function isPaused(ms, pause) {
  if (!pause || pause.start == null || pause.end == null || pause.start === pause.end) return false;
  const h = etHour(ms);
  return pause.start < pause.end ? h >= pause.start && h < pause.end : h >= pause.start || h < pause.end;
}

// Active (non-paused) milliseconds between two instants — stepping so a pause window is excluded.
function activeMsBetween(startMs, endMs, pause) {
  if (endMs <= startMs) return 0;
  if (!pause) return endMs - startMs;
  let cur = startMs;
  let active = 0;
  for (let i = 0; i < MAX_STEPS && cur < endMs; i++) {
    const next = Math.min(cur + STEP, endMs);
    if (!isPaused(cur, pause)) active += next - cur;
    cur = next;
  }
  return active;
}

// Walk forward from `fromMs` until `activeMs` of ACTIVE time has elapsed; return that instant (the
// deadline). Skips pause windows, so an overnight pause pushes the result out.
function addActiveMs(fromMs, activeMs, pause) {
  if (activeMs <= 0) return fromMs;
  if (!pause) return fromMs + activeMs;
  let cur = fromMs;
  let remaining = activeMs;
  for (let i = 0; i < MAX_STEPS && remaining > 0; i++) {
    if (isPaused(cur, pause)) { cur += STEP; continue; }
    const chunk = Math.min(STEP, remaining);
    cur += chunk;
    remaining -= chunk;
  }
  return cur;
}

// The live state of the current pick's clock.
//   clockStartMs : when the on-the-clock pick's timer started (the last pick's timestamp, or the
//                  draft start for pick 1)
//   pickHours    : the league's per-pick time limit, in hours
//   pause        : { start, end } ET-hour nightly pause window, or null
//   now          : current time (injectable for tests)
// Returns { deadlineMs, paused, remainingMs (active time left; <0 = overdue), overdue, elapsedActiveMs }.
function pickClockState(clockStartMs, pickHours, pause, now = Date.now()) {
  if (!clockStartMs || !pickHours || pickHours <= 0) return null;
  const needed = pickHours * HOUR;
  const deadlineMs = addActiveMs(clockStartMs, needed, pause);
  const elapsedActive = activeMsBetween(clockStartMs, now, pause);
  const remainingMs = needed - elapsedActive; // active time still on the clock
  return {
    deadlineMs,
    paused: isPaused(now, pause),
    remainingMs,
    overdue: remainingMs <= 0,
    elapsedActiveMs: elapsedActive,
  };
}

module.exports = { pickClockState, isPaused, activeMsBetween, addActiveMs, etHour };
