'use strict';
// Pure draft pick-clock math: a countdown from the last pick + the league's per-pick hours, honoring
// a nightly pause window (timers don't run overnight), so the deadline is pushed out by paused time
// and the countdown reads "paused" while we're inside the window.
process.env.MFL_DEMO_MODE = 'false';

const clock = require('../../src/lib/draftClock');
const leagueformat = require('../../src/lib/leagueformat');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const HOUR = 3600 * 1000;
const near = (a, b, tolMin = 6) => Math.abs(a - b) <= tolMin * 60 * 1000;
// ET hour of an instant (winter = EST, UTC-5), for readable asserts.
const etH = (ms) => Math.round(clock.etHour(ms) * 10) / 10;

(async () => {
  // 1) The owner's example: last pick 7:38 AM ET, 12h clock, NO pause → deadline 7:38 PM ET.
  const pick738 = Date.parse('2026-01-05T12:38:00Z'); // 7:38 AM EST
  const s1 = clock.pickClockState(pick738, 12, null, pick738);
  assert(near(s1.deadlineMs, pick738 + 12 * HOUR), 'no-pause: deadline = last pick + 12h');
  assert(etH(s1.deadlineMs) === 19.6, `deadline reads ~7:38 PM ET, got ${etH(s1.deadlineMs)}`);
  assert(!s1.paused && near(s1.remainingMs, 12 * HOUR), 'at the moment of the pick, 12h remain, not paused');
  console.log(`✓ no pause: 7:38 AM + 12h → ${etH(s1.deadlineMs)}h ET (7:38 PM), 12h on the clock`);

  // 2) Overnight pause 12am–8am ET. Last pick 11:00 PM ET, 12h clock: 1h runs (11pm→12am), pauses 8h,
  //    then 11h more (8am→7pm) → deadline ~7:00 PM ET the next day, ~20h of wall-clock later.
  const pick11pm = Date.parse('2026-01-06T04:00:00Z'); // 11:00 PM EST Jan 5
  const pause = { start: 0, end: 8 };
  const s2 = clock.pickClockState(pick11pm, 12, pause, pick11pm);
  assert(etH(s2.deadlineMs) === 19, `paused overnight: deadline ~7:00 PM ET, got ${etH(s2.deadlineMs)}`);
  assert(s2.deadlineMs - pick11pm > 19 * HOUR, 'the 8h pause pushed the 12h clock to ~20h of wall-clock');
  console.log(`✓ overnight pause: 11 PM + 12h (paused 12–8am) → ${etH(s2.deadlineMs)}h ET next day (~${Math.round((s2.deadlineMs - pick11pm) / HOUR)}h wall-clock)`);

  // 3) Right now is INSIDE the pause window → the countdown is frozen (paused=true) and doesn't tick.
  const at3am = Date.parse('2026-01-06T08:00:00Z'); // 3:00 AM EST
  const s3 = clock.pickClockState(pick11pm, 12, pause, at3am);
  assert(s3.paused === true, 'a 3 AM `now` inside 12–8am reads paused');
  // Only the 1 active hour (11pm→12am) counted; still ~11h of active time left, frozen.
  assert(near(s3.remainingMs, 11 * HOUR, 10), `~11h active time remains while paused, got ${Math.round(s3.remainingMs / HOUR)}h`);
  console.log(`✓ mid-pause: paused=${s3.paused}, ~${Math.round(s3.remainingMs / HOUR)}h active time left (frozen)`);

  // 4) A wrap-around window (11pm–7am) is handled, and an unconfigured clock returns null.
  assert(clock.isPaused(Date.parse('2026-01-06T05:00:00Z'), { start: 23, end: 7 }) === true, 'wrap window: 12am ET is paused under 11pm–7am');
  assert(clock.isPaused(Date.parse('2026-01-06T13:00:00Z'), { start: 23, end: 7 }) === false, 'wrap window: 8am ET is active');
  assert(clock.pickClockState(pick738, 0, null) === null && clock.pickClockState(null, 12, null) === null, 'no pickHours or no start → null (feature just off)');
  console.log('✓ wrap-around pause window + graceful null when unconfigured');

  // 5) Auto-detect the clock from MFL's real `league` export fields (no manual entry). Sampled from
  //    live league 69597: an 8h clock that suspends midnight–8am.
  const parsed = leagueformat.parseDraftClock({ draftLimitHours: '8:00', draftTimerSusp: '00 08', draftTimer: 'ONS' });
  assert(parsed && parsed.pickHours === 8, `draftLimitHours "8:00" -> 8h, got ${parsed && parsed.pickHours}`);
  assert(parsed.pause && parsed.pause.start === 0 && parsed.pause.end === 8, 'draftTimerSusp "00 08" -> pause 0–8');
  assert(parsed.source === 'mfl', 'auto-detected config is tagged source=mfl');
  // Fractional hours ("8:30" -> 8.5), no-pause (blank / equal), and "no clock" (0 / missing) all parse.
  assert(leagueformat.parseDraftClock({ draftLimitHours: '8:30' }).pickHours === 8.5, '"8:30" -> 8.5h');
  assert(leagueformat.parseDraftClock({ draftLimitHours: '12:00', draftTimerSusp: '' }).pause === null, 'blank susp -> no pause');
  assert(leagueformat.parseDraftClock({ draftLimitHours: '0:00' }) === null, '"0:00" clock -> null (feature off)');
  assert(leagueformat.parseDraftClock({}) === null && leagueformat.parseDraftClock(null) === null, 'missing fields -> null');
  console.log('✓ auto-detect from league export: 8:00 -> 8h, "00 08" -> pause 0–8, fractional/blank/off handled');

  console.log('\nDRAFT CLOCK HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
