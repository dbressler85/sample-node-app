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

const persist = require('../store/persist');
const sessionsStore = require('../store/sessions');
const draftService = require('./draft');
const tradesService = require('./trades');
const ondeckService = require('./ondeck');
const watchlistService = require('./watchlist');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const db = () => persist.ns('push'); // token -> { expoPushToken, prefs, primed, clockLeagues[], offerIds[] }

// The push channels the owner can toggle, all on by default. The keys are the source of
// truth for both the register merge and the prefs GET/POST, so a new channel is added in
// exactly one place.
const DEFAULT_PREFS = { draftClock: true, tradeOffer: true, lineupAttention: true, watchlist: true };
const CHANNELS = Object.keys(DEFAULT_PREFS);

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

// Default Expo push sender (POST to Expo's service). Swapped out in tests.
async function expoSend(messages) {
  if (!messages.length) return;
  try {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    console.log(`[notifications] expo send failed: ${e.message}`);
  }
}
let sender = expoSend;
function _setSender(fn) { sender = fn; }

// Compute the messages to send for one device given fresh draft + trade state,
// plus the new "seen" sets to store. Only *newly* on-the-clock leagues and
// *newly* seen offers fire.
function buildFor(state, draftOv, tradeOv, deck = { items: [] }, watchAlerts = { alerts: [] }) {
  const prefs = state.prefs || {};
  const msgs = [];

  const curClock = (draftOv.drafts || []).filter((d) => d.myOnClock);
  const clockLeagues = curClock.map((d) => d.leagueId);
  const prevClock = new Set(state.clockLeagues || []);

  const curOffers = tradeOv.offers || [];
  const offerIds = curOffers.map((o) => `${o.leagueId}:${o.id}`);
  const prevOffers = new Set(state.offerIds || []);

  // Lineup locks that need attention (from On Deck). Keyed by league + kickoff, so a
  // hole fires once per week per league — and re-fires next week's lock, not every tick.
  const curLineups = (deck.items || []).filter((i) => i.type === 'lineup_lock');
  const lineupKeys = curLineups.map((i) => `${i.leagueId}:${i.at || ''}`);
  const prevLineups = new Set(state.lineupKeys || []);

  // Watchlist alerts: a tracked player is newly a free agent / on another owner's block.
  const curWatch = watchAlerts.alerts || [];
  const watchKeys = curWatch.map((a) => `${a.type}:${a.playerId}:${a.leagueId}`);
  const prevWatch = new Set(state.watchKeys || []);

  // First tick after (re)registration primes the seen-sets without notifying, so
  // a freshly-enabled device isn't spammed with its already-existing state.
  if (state.primed) {
    if (prefs.draftClock !== false) {
      for (const d of curClock) {
        if (!prevClock.has(d.leagueId)) {
          msgs.push({ to: state.expoPushToken, title: "You're on the clock ⏱", body: `${d.name} — make your pick`, data: { type: 'draft_clock', leagueId: d.leagueId } });
        }
      }
    }
    if (prefs.tradeOffer !== false) {
      for (const o of curOffers) {
        if (!prevOffers.has(`${o.leagueId}:${o.id}`)) {
          msgs.push({ to: state.expoPushToken, title: 'New trade offer 🤝', body: `${o.leagueName} · from ${o.withName || 'another team'}`, data: { type: 'trade_offer', leagueId: o.leagueId, offerId: o.id } });
        }
      }
    }
    if (prefs.lineupAttention !== false) {
      for (const i of curLineups) {
        if (!prevLineups.has(`${i.leagueId}:${i.at || ''}`)) {
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
  }

  return { msgs, clockLeagues, offerIds, lineupKeys, watchKeys };
}

// One scheduler pass over every registered device.
async function tick(deps = {}) {
  const sessions = deps.sessions || sessionsStore;
  const draftOverview = deps.draftOverview || draftService.getOverview;
  const tradeOverview = deps.tradeOverview || tradesService.getOverview;
  const onDeck = deps.onDeck || ondeckService.getOnDeck;
  const watchAlerts = deps.watchAlerts || watchlistService.alerts;
  const send = deps.sender || sender;

  const d = db();
  const tokens = Object.keys(d);
  if (!tokens.length) return { tokens: 0, sent: 0 };

  let sent = 0;
  for (const token of tokens) {
    const state = d[token];
    if (!state.expoPushToken) continue; // prefs-only stub (no device token yet) — nothing to send to
    const session = sessions.get(token);
    if (!session) continue; // login expired — can't poll their MFL, skip (keep the registration)
    const prefs = state.prefs || {};
    try {
      const [draftOv, tradeOv, deck, watch] = await Promise.all([
        Promise.resolve(draftOverview(session.cookie, token)).catch(() => ({ drafts: [] })),
        Promise.resolve(tradeOverview(session.cookie, token)).catch(() => ({ offers: [] })),
        // Only pay for the extra reads when the device wants that channel.
        prefs.lineupAttention !== false ? Promise.resolve(onDeck(session.cookie, token)).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        prefs.watchlist !== false ? Promise.resolve(watchAlerts(session.cookie, token)).catch(() => ({ alerts: [] })) : Promise.resolve({ alerts: [] }),
      ]);
      const { msgs, clockLeagues, offerIds, lineupKeys, watchKeys } = buildFor(state, draftOv, tradeOv, deck, watch);
      state.clockLeagues = clockLeagues;
      state.offerIds = offerIds;
      state.lineupKeys = lineupKeys;
      state.watchKeys = watchKeys;
      state.primed = true;
      persist.touch();
      if (msgs.length) {
        await send(msgs);
        sent += msgs.length;
        console.log(`[notifications] sent ${msgs.length} to a device`);
      }
    } catch (e) {
      console.log(`[notifications] tick error: ${e.message}`);
    }
  }
  return { tokens: tokens.length, sent };
}

module.exports = { registerToken, unregister, getPrefs, setPrefs, tick, buildFor, _setSender, DEFAULT_PREFS };
