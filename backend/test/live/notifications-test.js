'use strict';
// Push-notification detection & dedup (PO review). Drives the scheduler tick with
// injected session + draft/trade state and a stub sender: the first tick primes
// (no spam), new on-the-clock / new offers fire once, unchanged state is silent,
// and going off-then-on the clock notifies again. Delivery itself (Expo) needs a
// real device; this covers the logic that decides what to send.
const os = require('os');
const path = require('path');
const fs = require('fs');

const DIR = path.join(os.tmpdir(), `dc-notify-${process.pid}`);
fs.rmSync(DIR, { recursive: true, force: true });
process.env.DATA_DIR = DIR;
process.env.MFL_DEMO_MODE = 'true';

const notifications = require('../../src/services/notifications');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const sent = [];
  const sessions = { get: (t) => (t === 'tok' ? { cookie: 'ck' } : null) };
  let draftState = { drafts: [] };
  let tradeState = { offers: [] };
  let deckState = { items: [] };
  let watchState = { alerts: [] };
  const deps = {
    sessions,
    draftOverview: async () => draftState,
    tradeOverview: async () => tradeState,
    onDeck: async () => deckState,
    watchAlerts: async () => watchState,
    sender: async (msgs) => { sent.push(...msgs); },
  };

  notifications.registerToken('tok', 'ExpoPushTok', {});

  // 1) First tick primes — even if there's already state, nothing is sent.
  draftState = { drafts: [{ leagueId: 'A', name: 'League A', myOnClock: true }] };
  tradeState = { offers: [{ leagueId: 'B', id: 't0', leagueName: 'League B', withName: 'Early Bird' }] };
  await notifications.tick(deps);
  assert(sent.length === 0, `first tick primes without notifying, sent ${sent.length}`);
  console.log('✓ first tick primes existing state (no spam on enable)');

  // 2) A NEW offer + a NEW on-the-clock league fire once each.
  draftState = { drafts: [{ leagueId: 'A', name: 'League A', myOnClock: true }, { leagueId: 'C', name: 'League C', myOnClock: true }] };
  tradeState = { offers: [{ leagueId: 'B', id: 't0', leagueName: 'League B', withName: 'Early Bird' }, { leagueId: 'D', id: 't9', leagueName: 'League D', withName: 'Rival' }] };
  await notifications.tick(deps);
  assert(sent.length === 2, `one new clock + one new offer notified, got ${sent.length}`);
  assert(sent.some((m) => m.data.type === 'draft_clock' && m.data.leagueId === 'C'), 'on-the-clock in League C notified');
  assert(sent.some((m) => m.data.type === 'trade_offer' && m.data.offerId === 't9'), 'new offer t9 notified');
  console.log('✓ new on-the-clock + new trade offer each notify once');

  // 3) Same state again -> nothing new.
  await notifications.tick(deps);
  assert(sent.length === 2, `no duplicate notifications, got ${sent.length}`);
  console.log('✓ unchanged state sends nothing (dedup)');

  // 4) Off the clock, then on again in the same league -> notifies again.
  draftState = { drafts: [{ leagueId: 'C', name: 'League C', myOnClock: false }] };
  await notifications.tick(deps);
  draftState = { drafts: [{ leagueId: 'C', name: 'League C', myOnClock: true }] };
  await notifications.tick(deps);
  assert(sent.length === 3, `re-entering the clock notifies again, got ${sent.length}`);
  console.log('✓ off-then-on the clock notifies again');

  // 5) Prefs off -> that channel goes quiet.
  notifications.registerToken('tok', 'ExpoPushTok', { tradeOffer: false });
  tradeState = { offers: [{ leagueId: 'E', id: 'tX', leagueName: 'League E', withName: 'Nope' }] };
  const before = sent.length;
  await notifications.tick(deps);
  assert(sent.length === before, 'tradeOffer=false suppresses trade notifications');
  console.log('✓ per-channel prefs respected (trade offers muted)');

  // 6) Expired session -> no send, no crash.
  const deps2 = { ...deps, sessions: { get: () => null } };
  const b2 = sent.length;
  const res = await notifications.tick(deps2);
  assert(sent.length === b2, 'expired session sends nothing');
  console.log('✓ expired login is skipped safely');

  // 7) A NEW lineup lock and NEW watchlist alerts fire once each (re-enable trade pref
  //    was off; use a fresh device so prefs are all-default and the seen-sets are clean).
  notifications.registerToken('tok2', 'ExpoPushTok2', {});
  const deps3 = { ...deps, sessions: { get: (t) => (t === 'tok2' ? { cookie: 'ck' } : null) } };
  draftState = { drafts: [] };
  tradeState = { offers: [] };
  await notifications.tick(deps3); // prime tok2
  const b3 = sent.length;
  deckState = { items: [{ type: 'lineup_lock', leagueId: 'L1', leagueName: 'League One', at: '2026-09-10T17:00:00Z', detail: 'empty slot — needs a pickup' }] };
  watchState = { alerts: [
    { type: 'free', playerId: 'p1', leagueId: 'L2', name: 'Jayden Marliss', leagueName: 'League Two' },
    { type: 'onblock', playerId: 'p2', leagueId: 'L3', name: 'Deion Bellamy', leagueName: 'League Three' },
  ] };
  await notifications.tick(deps3);
  const fresh = sent.slice(b3);
  assert(fresh.length === 3, `one lineup + two watch alerts fire, got ${fresh.length}`);
  assert(fresh.some((m) => m.data.type === 'lineup' && m.data.leagueId === 'L1'), 'lineup-attention notified');
  assert(fresh.some((m) => m.data.type === 'watch' && m.data.kind === 'free' && m.data.playerId === 'p1'), 'watchlist free-agent notified');
  assert(fresh.some((m) => m.data.type === 'watch' && m.data.kind === 'onblock' && m.data.playerId === 'p2'), 'watchlist on-the-block notified');
  console.log('✓ lineup-attention + watchlist alerts each notify once');

  // 8) Unchanged lineup/watch state -> no repeats (dedup by key).
  const b4 = sent.length;
  await notifications.tick(deps3);
  assert(sent.length === b4, 'unchanged lineup/watch state sends nothing');
  console.log('✓ lineup/watch dedup holds');

  // 9) Per-channel pref off -> that channel goes quiet even with new state.
  notifications.registerToken('tok2', 'ExpoPushTok2', { watchlist: false });
  watchState = { alerts: [{ type: 'free', playerId: 'p9', leagueId: 'L2', name: 'New Guy', leagueName: 'League Two' }] };
  const b5 = sent.length;
  await notifications.tick(deps3);
  assert(sent.length === b5, 'watchlist=false suppresses watch notifications');
  console.log('✓ watchlist channel can be muted');

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('\nNOTIFICATIONS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
