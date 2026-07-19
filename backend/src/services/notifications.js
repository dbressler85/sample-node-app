'use strict';

// Push notifications for the events a multi-league manager can't afford to miss:
// going ON THE CLOCK in a draft, and receiving a NEW TRADE OFFER. A scheduler
// (server.js) calls tick() on an interval; for each registered device it polls
// that user's draft + trade state (using their live session cookie), diffs
// against what was last seen, and pushes only the *new* events via Expo.
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

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const db = () => persist.ns('push'); // token -> { expoPushToken, prefs, primed, clockLeagues[], offerIds[] }

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
    prefs: { draftClock: true, tradeOffer: true, ...(existing.prefs || {}), ...(prefs || {}) },
    // If the token changed (new device/reinstall) re-prime so we don't replay
    // history to a fresh device.
    primed: existing.primed && existing.expoPushToken === expoPushToken ? existing.primed : false,
    clockLeagues: existing.clockLeagues || [],
    offerIds: existing.offerIds || [],
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
function buildFor(state, draftOv, tradeOv) {
  const prefs = state.prefs || {};
  const msgs = [];

  const curClock = (draftOv.drafts || []).filter((d) => d.myOnClock);
  const clockLeagues = curClock.map((d) => d.leagueId);
  const prevClock = new Set(state.clockLeagues || []);

  const curOffers = tradeOv.offers || [];
  const offerIds = curOffers.map((o) => `${o.leagueId}:${o.id}`);
  const prevOffers = new Set(state.offerIds || []);

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
  }

  return { msgs, clockLeagues, offerIds };
}

// One scheduler pass over every registered device.
async function tick(deps = {}) {
  const sessions = deps.sessions || sessionsStore;
  const draftOverview = deps.draftOverview || draftService.getOverview;
  const tradeOverview = deps.tradeOverview || tradesService.getOverview;
  const send = deps.sender || sender;

  const d = db();
  const tokens = Object.keys(d);
  if (!tokens.length) return { tokens: 0, sent: 0 };

  let sent = 0;
  for (const token of tokens) {
    const state = d[token];
    const session = sessions.get(token);
    if (!session) continue; // login expired — can't poll their MFL, skip (keep the registration)
    try {
      const [draftOv, tradeOv] = await Promise.all([
        Promise.resolve(draftOverview(session.cookie, token)).catch(() => ({ drafts: [] })),
        Promise.resolve(tradeOverview(session.cookie, token)).catch(() => ({ offers: [] })),
      ]);
      const { msgs, clockLeagues, offerIds } = buildFor(state, draftOv, tradeOv);
      state.clockLeagues = clockLeagues;
      state.offerIds = offerIds;
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

module.exports = { registerToken, unregister, tick, buildFor, _setSender };
