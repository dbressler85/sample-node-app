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
  const deps = {
    sessions,
    draftOverview: async () => draftState,
    tradeOverview: async () => tradeState,
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

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('\nNOTIFICATIONS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
