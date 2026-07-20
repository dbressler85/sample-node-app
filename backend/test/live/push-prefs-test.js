'use strict';

// Push preferences: get/set the per-channel push toggles. Prefs can be set before a
// device registers (stored and merged in later), only known boolean channels are
// accepted, and a prefs-only stub (no device token) never sends on a tick.

const os = require('os');
const path = require('path');
const fs = require('fs');

const DIR = path.join(os.tmpdir(), `dc-pushprefs-${process.pid}`);
fs.rmSync(DIR, { recursive: true, force: true });
process.env.DATA_DIR = DIR;
process.env.MFL_DEMO_MODE = 'true';

const notifications = require('../../src/services/notifications');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const TOK = 'prefs-tok';

  // 1) Defaults when nothing is stored — every channel on.
  const def = notifications.getPrefs(TOK).prefs;
  assert(def.draftClock && def.tradeOffer && def.lineupAttention && def.watchlist, 'all channels default on');

  // 2) Set some channels (before any device registration). Only known booleans stick.
  const saved = notifications.setPrefs(TOK, { lineupAttention: false, watchlist: false, bogus: true, tradeOffer: 'yes' }).prefs;
  assert(saved.lineupAttention === false && saved.watchlist === false, 'valid boolean channels are applied');
  assert(saved.draftClock === true && saved.tradeOffer === true, 'untouched channels keep their default; non-boolean ignored');
  assert(!('bogus' in saved), 'unknown channels are dropped');
  // Round-trips through getPrefs.
  assert(notifications.getPrefs(TOK).prefs.lineupAttention === false, 'getPrefs reflects the saved change');

  // 3) A prefs-only stub (no expoPushToken yet) never sends on a tick.
  const sent = [];
  const deps = {
    sessions: { get: (t) => (t === TOK ? { cookie: 'ck' } : null) },
    draftOverview: async () => ({ drafts: [{ leagueId: 'A', name: 'A', myOnClock: true }] }),
    tradeOverview: async () => ({ offers: [] }),
    onDeck: async () => ({ items: [] }),
    watchAlerts: async () => ({ alerts: [] }),
    sender: async (m) => { sent.push(...m); },
  };
  await notifications.tick(deps);
  await notifications.tick(deps); // even after priming, nothing to send to
  assert(sent.length === 0, 'prefs-only stub (no device token) sends nothing');

  // 4) Registering a device preserves the earlier pref choices (merge, not reset).
  notifications.registerToken(TOK, 'ExpoTok', {});
  const afterReg = notifications.getPrefs(TOK).prefs;
  assert(afterReg.lineupAttention === false && afterReg.watchlist === false, 'device registration keeps the pre-set prefs');
  assert(afterReg.draftClock === true, 'and the on-by-default channels stay on');

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('✓ push prefs: defaults, sanitized set, pre-registration storage, stub-never-sends, merge-on-register');
  console.log('\nPUSH PREFS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
