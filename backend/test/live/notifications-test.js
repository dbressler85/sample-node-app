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
  let waiverState = { results: [] };
  const deps = {
    sessions,
    draftOverview: async () => draftState,
    tradeOverview: async () => tradeState,
    onDeck: async () => deckState,
    watchAlerts: async () => watchState,
    waiverResults: async () => waiverState,
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

  // 8b) The pre-kickoff inactive sweep: the SAME league's lineup problem CHANGES mid-week (a starter
  //     you'd set is newly ruled OUT, opening a WR hole) → the attention push re-fires, instead of
  //     being silenced by the earlier same-week (same league+kickoff) notification.
  const b4b = sent.length;
  deckState = { items: [{ type: 'lineup_lock', leagueId: 'L1', leagueName: 'League One', at: '2026-09-10T17:00:00Z', status: 'risk', wiped: ['WR'], detail: 'No healthy player for your WR slot' }] };
  await notifications.tick(deps3);
  const relock = sent.slice(b4b);
  assert(relock.some((m) => m.data.type === 'lineup' && m.data.leagueId === 'L1'), 'a new mid-week lineup problem re-fires the attention push');
  console.log('✓ mid-week lineup change (starter ruled OUT) re-fires the attention push');

  // 9) Per-channel pref off -> that channel goes quiet even with new state.
  notifications.registerToken('tok2', 'ExpoPushTok2', { watchlist: false });
  watchState = { alerts: [{ type: 'free', playerId: 'p9', leagueId: 'L2', name: 'New Guy', leagueName: 'League Two' }] };
  const b5 = sent.length;
  await notifications.tick(deps3);
  assert(sent.length === b5, 'watchlist=false suppresses watch notifications');
  console.log('✓ watchlist channel can be muted');

  // 10) A NEW won waiver claim fires once with the FAAB bid in the body, dedups, and mutes on pref.
  const b6 = sent.length;
  waiverState = { results: [{ leagueId: 'L2', leagueName: 'League Two', add: 'Jaylen Wright', addId: 'w1', bid: 34, at: 1730000000 }] };
  await notifications.tick(deps3);
  const w = sent.slice(b6);
  assert(w.length === 1 && w[0].data.type === 'waiver_result' && w[0].data.leagueId === 'L2', `won waiver claim notifies once, got ${w.length}`);
  assert(/\$34/.test(w[0].body) && /Jaylen Wright/.test(w[0].body), `body carries the player + FAAB bid, got "${w[0].body}"`);
  console.log('✓ won waiver claim notifies once with the FAAB bid');

  const b7 = sent.length;
  await notifications.tick(deps3);
  assert(sent.length === b7, 'the same waiver result does not repeat (dedup)');
  console.log('✓ waiver-result dedup holds');

  notifications.registerToken('tok2', 'ExpoPushTok2', { waiverResult: false });
  waiverState = { results: [{ leagueId: 'L2', leagueName: 'League Two', add: 'Another Guy', addId: 'w2', bid: 5, at: 1730000100 }] };
  const b8 = sent.length;
  await notifications.tick(deps3);
  assert(sent.length === b8, 'waiverResult=false suppresses waiver notifications');
  console.log('✓ waiver-result channel can be muted');

  // 11) Slow-draft clock reminder: a long on-the-clock pick running low fires a SECOND nudge (with the
  //     time left) once, alongside the initial on-the-clock push; it then dedups.
  const b9 = sent.length;
  draftState = { drafts: [{ leagueId: 'D1', name: 'Slow League', myOnClock: true, myClock: { remainingMs: 90 * 60 * 1000, paused: false, overdue: false, pickHours: 8, round: 2, pick: 5 } }] };
  await notifications.tick(deps3);
  const cw = sent.slice(b9);
  assert(cw.some((m) => m.data.type === 'draft_clock' && m.data.leagueId === 'D1'), 'on-the-clock push fired');
  assert(cw.some((m) => m.data.type === 'draft_clock_warn' && m.data.leagueId === 'D1' && /1h 30m/.test(m.body)), 'clock-low reminder fired with the time left');
  console.log('✓ slow-draft clock reminder fires (with on-the-clock) showing time remaining');

  const b10 = sent.length;
  await notifications.tick(deps3);
  assert(sent.length === b10, 'clock reminder + on-the-clock do not repeat');
  console.log('✓ clock reminder dedups');

  // A FAST draft (short per-pick clock) gets the on-the-clock push but NO low-clock reminder.
  draftState = { drafts: [{ leagueId: 'D2', name: 'Fast League', myOnClock: true, myClock: { remainingMs: 60 * 1000, paused: false, overdue: false, pickHours: 0.03, round: 1, pick: 1 } }] };
  const b11 = sent.length;
  await notifications.tick(deps3);
  const fast = sent.slice(b11);
  assert(fast.some((m) => m.data.type === 'draft_clock' && m.data.leagueId === 'D2'), 'fast draft still gets on-the-clock');
  assert(!fast.some((m) => m.data.type === 'draft_clock_warn'), 'fast draft gets NO low-clock reminder');
  console.log('✓ fast draft: on-the-clock only, no low-clock reminder');

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('\nNOTIFICATIONS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
