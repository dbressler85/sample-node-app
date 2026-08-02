'use strict';

// Sunday pre-warm worker (#3). On game day, keep the lineup-relevant MFL reads for active users'
// leagues WARM in the shared cache across the morning→kickoff window, so both the Sunday-morning
// lineup-checkers and the 1pm-kickoff crowd hit warm cache instead of a cold cross-league fan-out.
//
// Why a recurring loop and not a single 6am prime: the dynasty-relevant reads have deliberately SHORT
// TTLs (rosters 5m, projections 30m, league settings 1h) because waivers process Sunday morning and
// injuries/byes update — a 7-hour-old roster/FAAB snapshot would be wrong exactly when it matters. So
// we re-warm on a cadence matched to the roster TTL; nothing served is ever more than one cycle stale.
//
// Everything runs at LOW priority, so it fills idle gaps in the request pipeline and never delays a
// real user. And because the warm reads share the exact cache keys real reads use, a league already
// refreshed by natural traffic is a free cache HIT — the loop self-throttles to zero work on busy
// leagues, and only actually fetches the cold/stale ones.

const config = require('../config');
const mfl = require('../lib/mfl');
const metrics = require('../lib/metrics');
const mflRepo = require('../lib/mflRepo');
const nflLib = require('../lib/nfl');
const playersLib = require('../lib/players');
const leaguesService = require('./leagues');
const sessions = require('../store/sessions');
const reqPriority = require('../lib/reqPriority');

const LOW = { priority: 'low' };

// The reads that back a Sunday lineup/scores check for one league — primed at low priority. Each is
// fail-soft: a warm miss is a non-event (the real request will just fetch it then).
async function warmLeague(cookie, league, week) {
  const jobs = [
    mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId, ...LOW }), // settings + starters
    mflRepo.rosters(league, cookie, LOW), // every franchise's roster
    mflRepo.freeAgentUnits(league, cookie, LOW), // waiver / free-agent pool
  ];
  if (week) {
    jobs.push(mflRepo.projectedScores(league, cookie, { W: week, ...LOW })); // this week's projections
    jobs.push(mflRepo.schedule(league, cookie, { W: week, ...LOW })); // matchup
  }
  await Promise.all(jobs.map((p) => p.catch(() => {})));
}

let running = false;
let lastRun = null; // { at, sessions, leagues, week, fetched } — surfaced on /_metrics

// One warm pass: over every active session's leagues (deduped), prime the lineup-relevant reads. The
// global reads (player DB, NFL week/injuries) are primed once — they're the same for everyone.
async function warmOnce() {
  if (running) return { skipped: true };
  running = true;
  const fetchesBefore = metrics.fetchCount();
  try {
    const active = sessions.active();
    if (!active.length) { lastRun = { at: Date.now(), sessions: 0, leagues: 0, fetched: 0 }; return { sessions: 0, leagues: 0 }; }
    // Global, everyone-shares reads: prime once using any live cookie.
    const anyCookie = active[0].cookie;
    const week = await nflLib.currentWeek(anyCookie).catch(() => null);
    await playersLib.load(anyCookie).catch(() => {}); // the big player DB (daily-cached, global)
    // Injuries is a shared site-wide feed hit on every roster/lineup build — prime it once so the
    // Sunday-morning availability reads land on a warm shared entry instead of a per-user cold fetch.
    if (week) await nflLib.injuryMap(anyCookie, week, LOW).catch(() => {});

    const seen = new Set();
    let leagues = 0;
    for (const s of active) {
      const list = await leaguesService.listLeagues(s.cookie).catch(() => []);
      for (const lg of list) {
        if (seen.has(lg.leagueId)) continue; // the shared cache also dedups the FETCH; skip the work too
        seen.add(lg.leagueId);
        await warmLeague(s.cookie, lg, week);
        leagues += 1;
      }
    }
    // `fetched` = warm reads that actually hit MFL; the rest were free cache hits (natural traffic
    // already warmed them). A low number here means the self-throttling is working.
    const fetched = metrics.fetchCount() - fetchesBefore;
    lastRun = { at: Date.now(), sessions: active.length, leagues, week, fetched };
    console.log(`[warm] primed ${leagues} league(s) across ${active.length} session(s), ${fetched} actual MFL fetches, week=${week ?? '—'}`);
    return { ...lastRun };
  } finally {
    running = false;
  }
}

// Is `d` inside the configured game-day window, in America/New_York? Football season spans EDT→EST,
// so we resolve the ET weekday + hour via Intl rather than a fixed UTC offset.
function inWindow(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(d);
  const wdName = parts.find((p) => p.type === 'weekday')?.value;
  const hourStr = parts.find((p) => p.type === 'hour')?.value;
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = WD[wdName];
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0; // some ICU builds render midnight as "24"
  return weekday === config.warmDayEt && hour >= config.warmStartHourEt && hour < config.warmEndHourEt;
}

let timer = null;
let valueTimer = null;

// Start the recurring worker. Ticks every warmIntervalMs; each tick warms only when inside the ET
// game-day window (a cheap no-op check otherwise). Gated to live (non-demo) mode by the caller.
function start() {
  if (timer) return;
  const tick = () => { if (inWindow()) warmOnce().catch((e) => console.warn(`[warm] pass failed: ${e.message}`)); };
  timer = setInterval(tick, config.warmIntervalMs);
  if (timer.unref) timer.unref(); // never keep the process alive just for warming
  console.log(`[warm] worker ON — ${config.warmStartHourEt}:00–${config.warmEndHourEt}:00 ET on day ${config.warmDayEt}, every ${Math.round(config.warmIntervalMs / 60000)}min`);
  tick(); // warm immediately if we're already inside the window at boot
}

// Background GLOBAL prime — ALWAYS-ON (not gated to the Sunday game-day window), so the slow-moving,
// league-agnostic reads that gate the app's cold loads (player DB, FantasyCalc value lenses for the
// common league sizes, prior-season stats) never go cold on a user's request. Runs on a cadence SHORTER
// than the 12h FantasyCalc TTL, so a background pass — not a user — is what re-fetches when it ages out.
// Requires an active session cookie to prime against; if nobody's signed in, the next real request
// warms it. require() here (not at top) so this stays a leaf and can't cycle with playerhub.
let valueLastRun = null; // { at, trigger } — surfaced on /_metrics so the prime is observable

async function primeValues() {
  const active = sessions.active();
  if (!active.length) return;
  const playerhub = require('./playerhub');
  // LOW: this is a background prime — its MFL reads (players DB) must never delay a foreground tap.
  // runLow makes every MFL read primeGlobals fans out inherit 'low' without threading a param through it.
  await reqPriority.runLow(() => playerhub.primeGlobals(active[0].cookie)).catch(() => {});
  valueLastRun = { at: Date.now(), trigger: 'timer' };
}
// Prime immediately against a specific cookie — called right after LOGIN (fire-and-forget), so the
// first board/roster load of a session is already warm instead of waiting for the next 6h tick (the
// boot pass no-ops when nobody's signed in yet). Idempotent: a warm cache makes this a cheap no-op, so
// it only does real work on the first login after a cold deploy. Never blocks the login response.
function primeNow(cookie) {
  if (config.demoMode || !cookie) return;
  const playerhub = require('./playerhub');
  // LOW even though it fires at login: the user's FIRST foreground board/roster loads happen right now,
  // so the prime's players-DB fetch must sit in the background lane and let those preempt it (the exact
  // priority-inversion the LOW lane exists to prevent).
  reqPriority.runLow(() => playerhub.primeGlobals(cookie))
    .then(() => { valueLastRun = { at: Date.now(), trigger: 'login' }; })
    .catch(() => {});
}
function startValuePrime() {
  if (valueTimer) return;
  primeValues().catch(() => {}); // prime once at boot
  valueTimer = setInterval(() => primeValues().catch(() => {}), config.valuePrimeIntervalMs);
  if (valueTimer.unref) valueTimer.unref();
  console.log(`[warm] global prime ON — every ${Math.round(config.valuePrimeIntervalMs / 3600000)}h`);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (valueTimer) { clearInterval(valueTimer); valueTimer = null; }
}

// Worker state for the /_metrics view.
function stats() {
  return {
    enabled: !!(config.warmEnabled && !config.demoMode),
    running: !!timer,
    inWindow: inWindow(),
    windowEt: `${config.warmStartHourEt}:00–${config.warmEndHourEt}:00 ET (day ${config.warmDayEt})`,
    intervalMs: config.warmIntervalMs,
    lastRun,
    // Background global prime (value lenses + player DB + stats): whether it's running and when it last
    // ran (trigger 'login' | 'timer'). Lets you confirm at a glance that the prime is actually priming.
    valuePrime: { on: !!valueTimer, intervalMs: config.valuePrimeIntervalMs, lastRun: valueLastRun },
  };
}

module.exports = { start, stop, warmOnce, startValuePrime, primeNow, inWindow, stats };
