'use strict';

// Unit tests for the device-first orchestration (src/preferDevice.js) — A-12. Exercises the fallback
// selection, `_source` tagging, and beacon behavior with fake collaborators + the REAL (pure) deviceHealth,
// so the offline-cooldown / beacon-suppression integration is covered too. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const createPreferDevice = require('../src/preferDevice');
const deviceHealth = require('../src/deviceHealth');

function build(overrides = {}) {
  const beacons = [];
  const opts = {
    ready: async () => true,
    health: deviceHealth,
    beacon: (name, source, meta) => beacons.push({ name, source, meta }),
    onCookieExpired: () => { opts._cookieExpiredCalls = (opts._cookieExpiredCalls || 0) + 1; },
    version: 7,
    ...overrides,
  };
  deviceHealth._reset();
  return { preferDevice: createPreferDevice(opts), beacons, opts };
}

test('device success: returns device data tagged _source, backend not called, beacon = device', async () => {
  let backendCalls = 0;
  const { preferDevice, beacons } = build();
  const out = await preferDevice('rosters', async () => ({ teams: [1] }), async () => { backendCalls += 1; return {}; });
  assert.deepEqual(out.teams, [1]);
  assert.equal(out._source, 'device');
  assert.equal(backendCalls, 0, 'the backend is not called when the device succeeds');
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].source, 'device');
  assert.equal(beacons[0].meta.ver, 7, 'the beacon carries the shared-core version (A-6)');
  assert.equal(beacons[0].meta.reason, null);
});

test('device failure: falls back to the backend, tagged backend, beacon carries the reason', async () => {
  const { preferDevice, beacons } = build();
  const out = await preferDevice('drafts', async () => { throw new Error('boom'); }, async () => ({ drafts: [] }));
  assert.equal(out._source, 'backend');
  assert.deepEqual(out.drafts, []);
  assert.equal(beacons[0].source, 'backend');
  assert.equal(beacons[0].meta.reason, 'error', 'a generic device error is classified + beaconed');
});

test('ready() false: device not attempted, backend served, no fallback reason', async () => {
  let deviceCalls = 0;
  const { preferDevice, beacons } = build({ ready: async () => false });
  const out = await preferDevice('lineups', async () => { deviceCalls += 1; return {}; }, async () => ({ ok: 1 }));
  assert.equal(deviceCalls, 0, 'the device fn is not invoked when ready() is false');
  assert.equal(out._source, 'backend');
  assert.equal(beacons[0].meta.reason, null, 'a backend read with device off is not a "fallback"');
});

test('TWO consecutive network failures open the offline cooldown; one does not (U-3)', async () => {
  deviceHealth._reset();
  const { preferDevice, beacons } = build();
  const netFail = () => preferDevice('portfolio', async () => { throw new Error('Network request failed'); }, async () => ({ ok: 1 }));
  const out1 = await netFail();
  assert.equal(out1._source, 'backend');
  assert.equal(deviceHealth.deviceSuppressed(), false, 'ONE network failure does not suppress — it could be one slow league, not a dead network');
  const out2 = await netFail();
  assert.equal(out2._source, 'backend');
  assert.equal(deviceHealth.deviceSuppressed(), true, 'two consecutive network failures open the offline cooldown');
  // The beacon storm is what U-3 guards: the first failure still beacons (network looks up), but once the
  // cooldown is open the second (and subsequent) fallbacks fire no beacon to the dead network.
  assert.equal(beacons.length, 1, 'no beacon storm once the network is believed down');
});

test('a SKIPPED read inside the offline cooldown does not clear it — suppression actually holds', async () => {
  deviceHealth._reset();
  // ready() mirrors the real app: attempt the device only when NOT suppressed.
  const { preferDevice } = build({ ready: async () => !deviceHealth.deviceSuppressed() });
  const netFail = () => preferDevice('rosters', async () => { throw new Error('Network request failed'); }, async () => ({ ok: 1 }));
  await netFail(); // 1st network failure (device attempted)
  await netFail(); // 2nd consecutive → opens the 15s cooldown
  assert.equal(deviceHealth.deviceSuppressed(), true, 'two consecutive failures open the cooldown');
  // The next read is SKIPPED (ready=false while suppressed) and served from the backend. It must NOT clear
  // the cooldown — before the fix, noteResult(null) on the skip evaporated the 15s window immediately.
  const out = await preferDevice('rosters', async () => ({ never: true }), async () => ({ ok: 1 }));
  assert.equal(out._source, 'backend', 'a suppressed read serves from the backend');
  assert.equal(deviceHealth.deviceSuppressed(), true, 'the cooldown still HOLDS after a skipped read — it is not cleared by a skip');
});

test('expired cookie triggers the cred refresh (U-7) then falls back', async () => {
  const { preferDevice, opts } = build();
  const out = await preferDevice('rosters', async () => { const e = new Error('nope'); e.status = 401; throw e; }, async () => ({ ok: 1 }));
  assert.equal(out._source, 'backend');
  assert.equal(opts._cookieExpiredCalls, 1, 'onCookieExpired fired for a 401');
});

test('device reads off (beacon null): no beacon, still returns the served payload', async () => {
  const { preferDevice, beacons } = build({ beacon: null });
  const out = await preferDevice('rosters', async () => ({ teams: [] }), async () => ({}));
  assert.equal(out._source, 'device');
  assert.equal(beacons.length, 0);
});
