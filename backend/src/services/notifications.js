'use strict';

// Push notifications for the events a multi-league manager can't afford to miss:
// going ON THE CLOCK in a draft, a NEW TRADE OFFER, a LINEUP that needs attention
// before kickoff, and a WATCHLIST player who's newly a free agent or on another
// owner's block. A scheduler (server.js) calls tick() on an interval; for each
// registered device it polls that user's state (using their live session cookie),
// diffs against what was last seen, and pushes only the *new* events via Expo. Each
// channel is independently toggleable via prefs and only polled when enabled.
//
// Honest limits: background polling needs the user's MFL session cookie, so we
// can only notify while their login is valid (12h) — there's no stored password.
// Delivery itself (Expo push) and token retrieval require a real device/build;
// the detection + dedup logic here is what the tests cover.
//
// Extensible by design: add an event type by pushing to `msgs` in buildFor and
// tracking its "seen" set on the per-device state (see draft/trade below).

const config = require('../config');
const persist = require('../store/persist');
const sessionsStore = require('../store/sessions');
const draftService = require('./draft');
const tradesService = require('./trades');
const ondeckService = require('./ondeck');
const watchlistService = require('./watchlist');
const waiversService = require('./waivers');
const historyStore = require('../store/portfolioHistory');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const db = () => persist.ns('push'); // token -> { expoPushToken, prefs, primed, clockLeagues[], offerIds[] }

// The push channels the owner can toggle, all on by default. The keys are the source of
// truth for both the register merge and the prefs GET/POST, so a new channel is added in
// exactly one place.
const DEFAULT_PREFS = { draftClock: true, tradeOffer: true, lineupAttention: true, watchlist: true, waiverResult: true, valueMove: true };
const CHANNELS = Object.keys(DEFAULT_PREFS);

// How big a week-over-week swing in total dynasty value is worth a nudge. The offseason (no lineups /
// waivers / trades most weeks) is when this channel earns its keep — a reason to open the app when the
// in-season signals are quiet. Kept high enough that normal daily noise doesn't fire it.
const VALUE_MOVE_PCT_BAR = 3;

// Slow/email-draft clock reminder: a SECOND nudge (after "you're on the clock") when your pick timer is
// about to expire, so a long clock doesn't quietly lapse into an autopick you didn't want. Only for
// genuinely slow drafts (a multi-hour clock) — a fast/live draft's short clock is already covered by
// the on-the-clock push, and reminding at 2h-left there would just double up.
const CLOCK_REMINDER_MS = 2 * 60 * 60 * 1000; // fire when ≤ 2h of ACTIVE time remains
const SLOW_DRAFT_MIN_HOURS = 4; // ...and only if the per-pick clock is at least this long

// "1h 45m" / "45m" / "8m" from remaining ms.
function shortDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

// "+1,240" / "−980" — a signed, thousands-grouped whole number for the push body.
function signedInt(n) {
  const v = Math.round(Math.abs(n)).toLocaleString();
  return n >= 0 ? `+${v}` : `−${v}`;
}

// A week-over-week move from the stored daily total-value series ([{ date:'YYYY-MM-DD', value }]).
// Compares the newest point to the newest point at least 6 days older (falling back to the oldest),
// so it reads as "over the past week". Pure — the series is the already-computed portfolio history,
// so this costs no MFL read. Returns { pct, absolute, latest, date } or null when it can't compute.
function weeklyMove(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const latest = series[series.length - 1];
  if (!latest || !(latest.value > 0)) return null;
  const latestT = Date.parse(`${latest.date}T00:00:00Z`);
  if (!Number.isFinite(latestT)) return null;
  let base = series[0];
  for (let i = series.length - 2; i >= 0; i--) {
    const t = Date.parse(`${series[i].date}T00:00:00Z`);
    if (Number.isFinite(t) && latestT - t >= 6 * 24 * 60 * 60 * 1000) { base = series[i]; break; }
  }
  if (!base || !(base.value > 0) || base.date === latest.date) return null;
  const absolute = latest.value - base.value;
  const pct = Math.round((absolute / base.value) * 1000) / 10; // one decimal
  return { pct, absolute, latest: latest.value, date: latest.date };
}

function registerToken(token, expoPushToken, prefs) {
  if (!token || !expoPushToken) {
    const e = new Error('An Expo push token is required.');
    e.status = 400;
    throw e;
  }
  const d = db();
  const existing = d[token] || {};
  d[token] = {
    expoPushToken,
    prefs: { ...DEFAULT_PREFS, ...(existing.prefs || {}), ...(prefs || {}) },
    // If the token changed (new device/reinstall) re-prime so we don't replay
    // history to a fresh device.
    primed: existing.primed && existing.expoPushToken === expoPushToken ? existing.primed : false,
    clockLeagues: existing.clockLeagues || [],
    offerIds: existing.offerIds || [],
    lineupKeys: existing.lineupKeys || [],
    watchKeys: existing.watchKeys || [],
    waiverKeys: existing.waiverKeys || [],
    clockWarnKeys: existing.clockWarnKeys || [],
    valueMoveKey: existing.valueMoveKey || null,
  };
  persist.touch();
  return { ok: true, prefs: d[token].prefs };
}

function unregister(token) {
  const d = db();
  if (d[token]) {
    delete d[token];
    persist.touch();
  }
  return { ok: true };
}

// Current push-channel prefs for this session (defaults when nothing's stored yet).
function getPrefs(token) {
  const e = db()[token];
  return { prefs: { ...DEFAULT_PREFS, ...(e && e.prefs) } };
}

// Update push-channel prefs. Accepts only known boolean channels (ignores junk). Works
// even before a device has registered a push token — the choice is stored and merged in
// when registerToken later runs, so the Settings screen is usable regardless of order.
function setPrefs(token, incoming) {
  const clean = {};
  for (const k of CHANNELS) if (incoming && typeof incoming[k] === 'boolean') clean[k] = incoming[k];
  const d = db();
  const e = d[token] || {};
  d[token] = { ...e, prefs: { ...DEFAULT_PREFS, ...(e.prefs || {}), ...clean } };
  persist.touch();
  return { ok: true, prefs: d[token].prefs };
}

// Remove every registration pointing at a dead Expo token (Expo says DeviceNotRegistered —
// the app was uninstalled or the token rotated), so the scheduler stops trying it forever.
function pruneExpoToken(expoPushToken) {
  const d = db();
  let changed = false;
  for (const k of Object.keys(d)) {
    if (d[k] && d[k].expoPushToken === expoPushToken) { delete d[k]; changed = true; }
  }
  if (changed) persist.touch();
}

// Default Expo push sender (POST to Expo's service). Swapped out in tests. Unlike the old
// fire-and-forget version, this READS Expo's response: a rejected request (bad credentials, FCM not
// configured, malformed) and per-message ticket errors (DeviceNotRegistered, MessageTooBig, …) are
// logged with detail instead of silently swallowed — that silence is why "no push ever arrived"
// went undiagnosed. Returns { tickets, errors } so callers (the test endpoint) can surface it.
async function expoSend(messages) {
  if (!messages.length) return { tickets: [], errors: [] };
  const headers = { Accept: 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' };
  if (config.expoAccessToken) headers.Authorization = `Bearer ${config.expoAccessToken}`;
  try {
    const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
    let body = null;
    try { body = await res.json(); } catch (_) { /* non-JSON error body */ }
    if (!res.ok) {
      const detail = body && body.errors ? JSON.stringify(body.errors) : `HTTP ${res.status}`;
      console.log(`[notifications] expo push REJECTED: ${detail}`);
      return { tickets: [], errors: [{ status: res.status, detail }] };
    }
    const tickets = (body && body.data) || [];
    const errors = [];
    tickets.forEach((t, i) => {
      if (t && t.status === 'error') {
        const code = t.details && t.details.error;
        const to = messages[i] && messages[i].to;
        errors.push({ message: t.message, code: code || null, to });
        console.log(`[notifications] ticket error: ${t.message}${code ? ` (${code})` : ''}`);
        if (code === 'DeviceNotRegistered' && to) pruneExpoToken(to);
      }
    });
    return { tickets, errors };
  } catch (e) {
    console.log(`[notifications] expo send failed: ${e.message}`);
    return { tickets: [], errors: [{ message: e.message }] };
  }
}
let sender = expoSend;
function _setSender(fn) { sender = fn; }

// Send a diagnostic push to this account's registered device and RETURN Expo's verdict, so the app
// can show exactly where the pipeline stands without waiting for a real draft/trade event:
//   • no-token  → the device never registered (permission denied, or not built with push)
//   • errors[]  → Expo rejected it (e.g. FCM not configured for Android, or DeviceNotRegistered)
//   • ok:true   → Expo ACCEPTED it; if the phone still shows nothing, the gap is device/OS delivery
async function sendTest(account, send = sender) {
  const entry = db()[account];
  if (!entry || !entry.expoPushToken) return { ok: false, reason: 'no-token' };
  const result = (await send([{ to: entry.expoPushToken, title: 'Dynasty Central', body: 'Test notification — push is working ✅', data: { type: 'test' } }])) || {};
  const errors = result.errors || [];
  return { ok: errors.length === 0, reason: errors.length ? 'expo-error' : 'ok', errors, tickets: result.tickets || [] };
}

// One-shot diagnosis of the push pipeline for THIS account, so "I got no notification" can be pinned to
// the exact broken link instead of guessed at. Reports, in order of the pipeline: is a device token
// registered; is a live MFL session present (the tick needs one to poll — without SESSION_SECRET a
// backend redeploy wipes it); is the account primed; and the delivery-config flags (an Expo access
// token / FCM being set). Best-effort polls the draft overview so we can also say whether the server
// currently SEES you on the clock — the single most useful signal during a live draft.
async function getStatus(account, deps = {}) {
  const sessions = deps.sessions || sessionsStore;
  const entry = db()[account] || null;
  const session = (sessions.getByAccount && sessions.getByAccount(account)) || (sessions.get && sessions.get(account)) || null;
  const status = {
    registered: !!(entry && entry.expoPushToken),
    primed: !!(entry && entry.primed),
    prefs: { ...DEFAULT_PREFS, ...((entry && entry.prefs) || {}) },
    sessionLive: !!session,
    lastSeenClockLeagues: (entry && entry.clockLeagues) || [],
    // Infra flags the owner controls — the usual real-world blockers.
    config: {
      expoAccessToken: !!config.expoAccessToken, // Expo/FCM auth header for the sender
      sessionSecret: !!config.sessionSecret, // sessions persist across redeploys only when set
      demoMode: !!config.demoMode,
    },
  };
  if (session) {
    try {
      const draftOverview = deps.draftOverview || draftService.getOverview;
      const ov = await Promise.resolve(draftOverview(session.cookie, account));
      status.onClockNow = (ov.drafts || []).filter((d) => d.myOnClock).map((d) => ({ leagueId: d.leagueId, name: d.name }));
    } catch (e) {
      status.onClockNow = { error: e.message };
    }
  }
  return status;
}

// Compute the messages to send for one device given fresh draft + trade state,
// plus the new "seen" sets to store. Only *newly* on-the-clock leagues and
// *newly* seen offers fire.
function buildFor(state, draftOv, tradeOv, deck = { items: [] }, watchAlerts = { alerts: [] }, waiverRes = { results: [] }, valueSeries = []) {
  const prefs = state.prefs || {};
  const msgs = [];

  const curClock = (draftOv.drafts || []).filter((d) => d.myOnClock);
  const clockLeagues = curClock.map((d) => d.leagueId);
  const prevClock = new Set(state.clockLeagues || []);

  // Slow-draft "clock running low" reminders: my on-the-clock picks whose long timer is within the
  // final window and actively counting (not paused/overdue). Keyed by league + the exact pick, so it
  // fires once per pick — and again for the next pick, but never twice for the same one.
  const curClockWarn = curClock.filter((d) => {
    const c = d.myClock;
    return c && !c.paused && !c.overdue && c.remainingMs > 0 && c.remainingMs <= CLOCK_REMINDER_MS && (c.pickHours || 0) >= SLOW_DRAFT_MIN_HOURS;
  });
  const clockWarnKeys = curClockWarn.map((d) => `${d.leagueId}:${d.myClock.round}.${d.myClock.pick}`);
  const prevClockWarn = new Set(state.clockWarnKeys || []);

  const curOffers = tradeOv.offers || [];
  const offerIds = curOffers.map((o) => `${o.leagueId}:${o.id}`);
  const prevOffers = new Set(state.offerIds || []);

  // Lineup locks that need attention (from On Deck). Keyed by league + kickoff + the PROBLEM (status +
  // which starting slots are wiped), so it fires once per week per league AND re-fires within the week
  // when the problem changes — e.g. a starter you'd set is newly ruled OUT (optimal→suboptimal, or a
  // new position hole). That's the "pre-kickoff inactive sweep": you get told your lineup broke, even
  // after you already set it, instead of a single stale notification per week.
  const curLineups = (deck.items || []).filter((i) => i.type === 'lineup_lock');
  const lineupKey = (i) => `${i.leagueId}:${i.at || ''}:${i.status || ''}:${(i.wiped || []).slice().sort().join(',')}`;
  const lineupKeys = curLineups.map(lineupKey);
  const prevLineups = new Set(state.lineupKeys || []);

  // Watchlist alerts: a tracked player is newly a free agent / on another owner's block.
  const curWatch = watchAlerts.alerts || [];
  const watchKeys = curWatch.map((a) => `${a.type}:${a.playerId}:${a.leagueId}`);
  const prevWatch = new Set(state.watchKeys || []);

  // Waiver RESULTS: a claim of yours processed — you won a player (with the winning FAAB bid). Keyed by
  // league + player + processed-time so each won claim fires exactly once (the transactions log keeps
  // showing it on later ticks).
  const curWaivers = waiverRes.results || [];
  const waiverKeys = curWaivers.map((r) => `${r.leagueId}:${r.addId || r.add}:${r.at}`);
  const prevWaivers = new Set(state.waiverKeys || []);

  // Portfolio value MOVE: a notable week-over-week swing in total dynasty value, read from the
  // already-computed daily history (no MFL read). Keyed by latest date + pct so a given move fires
  // exactly once; a sub-threshold tick keeps the last key so we never re-fire the same move.
  const move = weeklyMove(valueSeries);
  const moveKey = move && Math.abs(move.pct) >= VALUE_MOVE_PCT_BAR ? `${move.date}:${move.pct}` : null;
  const prevMoveKey = state.valueMoveKey || null;

  // Draft clock is CURRENT state, not replayable history — being on the clock RIGHT NOW is exactly what
  // you want pushed, including on the very first tick after a reinstall (a new Expo token resets
  // `primed` to false). So this channel is EXEMPT from the priming gate below; the `prevClock` seen-set
  // still dedups it to one push per on-clock transition, so it never repeats every 45s. (Uninstall →
  // reinstall → go on the clock is the exact test path, and priming it away is why that came up empty.)
  if (prefs.draftClock !== false) {
    for (const d of curClock) {
      if (!prevClock.has(d.leagueId)) {
        msgs.push({ to: state.expoPushToken, title: "You're on the clock ⏱", body: `${d.name} — make your pick`, data: { type: 'draft_clock', leagueId: d.leagueId } });
      }
    }
    // Slow-draft expiry reminder (same channel): fires once per pick as its long clock runs low.
    for (const d of curClockWarn) {
      if (!prevClockWarn.has(`${d.leagueId}:${d.myClock.round}.${d.myClock.pick}`)) {
        msgs.push({ to: state.expoPushToken, title: 'Pick clock running low ⏳', body: `${d.name} — about ${shortDur(d.myClock.remainingMs)} left to pick ${d.myClock.round}.${String(d.myClock.pick).padStart(2, '0')}`, data: { type: 'draft_clock_warn', leagueId: d.leagueId } });
      }
    }
  }

  // The remaining channels CAN carry a backlog (standing trade offers, prior waiver results, an
  // existing lineup problem, watchlist matches). Prime those silently on the first tick after
  // (re)registration so a freshly-enabled device isn't spammed with its already-existing state.
  if (state.primed) {
    if (prefs.tradeOffer !== false) {
      for (const o of curOffers) {
        if (!prevOffers.has(`${o.leagueId}:${o.id}`)) {
          msgs.push({ to: state.expoPushToken, title: 'New trade offer 🤝', body: `${o.leagueName} · from ${o.withName || 'another team'}`, data: { type: 'trade_offer', leagueId: o.leagueId, offerId: o.id } });
        }
      }
    }
    if (prefs.lineupAttention !== false) {
      for (const i of curLineups) {
        if (!prevLineups.has(lineupKey(i))) {
          msgs.push({ to: state.expoPushToken, title: 'Lineup needs attention ⚑', body: `${i.leagueName} — ${i.detail || 'set your starters'}`, data: { type: 'lineup', leagueId: i.leagueId } });
        }
      }
    }
    if (prefs.watchlist !== false) {
      for (const a of curWatch) {
        if (!prevWatch.has(`${a.type}:${a.playerId}:${a.leagueId}`)) {
          const free = a.type === 'free';
          msgs.push({
            to: state.expoPushToken,
            title: free ? 'Watchlist: now a free agent 🔎' : 'Watchlist: on the block 🔁',
            body: `${a.name} · ${a.leagueName}`,
            data: { type: 'watch', kind: a.type, playerId: a.playerId, leagueId: a.leagueId },
          });
        }
      }
    }
    if (prefs.waiverResult !== false) {
      for (const r of curWaivers) {
        if (!prevWaivers.has(`${r.leagueId}:${r.addId || r.add}:${r.at}`)) {
          const cost = r.bid != null ? ` for $${r.bid}` : '';
          msgs.push({
            to: state.expoPushToken,
            title: 'Waiver won ✅',
            body: `${r.leagueName} — added ${r.add}${cost}`,
            data: { type: 'waiver_result', leagueId: r.leagueId, playerId: r.addId || null },
          });
        }
      }
    }
    // Value move is backlog-priming like the others — a fresh device isn't nudged about a standing
    // number; only a NEW notable swing fires, exactly once (deduped by moveKey).
    if (prefs.valueMove !== false && moveKey && moveKey !== prevMoveKey) {
      const up = move.absolute >= 0;
      msgs.push({
        to: state.expoPushToken,
        title: up ? 'Your dynasty value is up 📈' : 'Your dynasty value dipped 📉',
        body: `${up ? '+' : ''}${move.pct}% over the past week (${signedInt(move.absolute)}).`,
        data: { type: 'value_move' },
      });
    }
  }

  return { msgs, clockLeagues, offerIds, lineupKeys, watchKeys, waiverKeys, clockWarnKeys, valueMoveKey: moveKey || prevMoveKey };
}

// One scheduler pass over every registered device.
async function tick(deps = {}) {
  const sessions = deps.sessions || sessionsStore;
  const draftOverview = deps.draftOverview || draftService.getOverview;
  const tradeOverview = deps.tradeOverview || tradesService.getOverview;
  const onDeck = deps.onDeck || ondeckService.getOnDeck;
  const watchAlerts = deps.watchAlerts || watchlistService.alerts;
  const waiverResults = deps.waiverResults || waiversService.recentResults;
  const send = deps.sender || sender;

  const d = db();
  const tokens = Object.keys(d); // registration keys — the stable account key in prod
  if (!tokens.length) return { tokens: 0, sent: 0 };

  let sent = 0;
  for (const token of tokens) {
    const state = d[token];
    if (!state.expoPushToken) continue; // prefs-only stub (no device token yet) — nothing to send to
    // Registrations are keyed by account, but polling needs a live session cookie —
    // find whatever session that account currently holds (falling back to a direct
    // token lookup for test stubs / any legacy token-keyed registration).
    const session = (sessions.getByAccount && sessions.getByAccount(token)) || sessions.get(token);
    if (!session) continue; // login expired — can't poll their MFL, skip (keep the registration)
    const prefs = state.prefs || {};
    try {
      const [draftOv, tradeOv, deck, watch, waiverRes] = await Promise.all([
        Promise.resolve(draftOverview(session.cookie, token)).catch(() => ({ drafts: [] })),
        Promise.resolve(tradeOverview(session.cookie, token)).catch(() => ({ offers: [] })),
        // Only pay for the extra reads when the device wants that channel.
        prefs.lineupAttention !== false ? Promise.resolve(onDeck(session.cookie, token)).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        prefs.watchlist !== false ? Promise.resolve(watchAlerts(session.cookie, token)).catch(() => ({ alerts: [] })) : Promise.resolve({ alerts: [] }),
        prefs.waiverResult !== false ? Promise.resolve(waiverResults(session.cookie, token)).catch(() => ({ results: [] })) : Promise.resolve({ results: [] }),
      ]);
      // The value-move series is the already-computed portfolio history (a cheap durable-store read,
      // no MFL fan-out), so it's read here rather than in the Promise.all above.
      const valueSeries = prefs.valueMove !== false ? historyStore.history(token) : [];
      const { msgs, clockLeagues, offerIds, lineupKeys, watchKeys, waiverKeys, clockWarnKeys, valueMoveKey } = buildFor(state, draftOv, tradeOv, deck, watch, waiverRes, valueSeries);
      state.clockLeagues = clockLeagues;
      state.offerIds = offerIds;
      state.lineupKeys = lineupKeys;
      state.watchKeys = watchKeys;
      state.waiverKeys = waiverKeys;
      state.clockWarnKeys = clockWarnKeys;
      state.valueMoveKey = valueMoveKey;
      state.primed = true;
      persist.touch();
      if (msgs.length) {
        const r = (await send(msgs)) || {};
        const errCount = (r.errors || []).length;
        sent += msgs.length - errCount;
        // Honest log: how many Expo actually ACCEPTED (the old code logged "sent" even when Expo
        // rejected every message, which is exactly why silent failures never surfaced).
        console.log(`[notifications] built ${msgs.length} for a device — ${msgs.length - errCount} accepted${errCount ? `, ${errCount} errored (see ticket error above)` : ''}`);
      }
    } catch (e) {
      console.log(`[notifications] tick error: ${e.message}`);
    }
  }
  return { tokens: tokens.length, sent };
}

module.exports = { registerToken, unregister, getPrefs, setPrefs, tick, buildFor, sendTest, getStatus, weeklyMove, _setSender, DEFAULT_PREFS };
