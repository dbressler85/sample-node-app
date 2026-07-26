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

test('network failure opens the offline cooldown AND suppresses its own beacon (U-3)', async () => {
  const { preferDevice, beacons } = build();
  const out = await preferDevice('portfolio', async () => { throw new Error('Network request failed'); }, async () => ({ ok: 1 }));
  assert.equal(out._source, 'backend');
  assert.equal(deviceHealth.deviceSuppressed(), true, 'a network failure opens the offline cooldown');
  assert.equal(beacons.length, 0, 'no beacon is fired to a dead network');
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
