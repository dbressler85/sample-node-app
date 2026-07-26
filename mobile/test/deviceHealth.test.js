'use strict';

// Unit tests for device-origin health (src/deviceHealth.js): failure classification (incl. the U-7
// expired-cookie bucket) and the U-3 offline cooldown (fail fast + don't beacon a dead network). Pure with
// an injectable clock. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const dh = require('../src/deviceHealth');

test('classifyError: expired cookie (401/403) is distinct from a missing cookie (U-7)', () => {
  assert.equal(dh.classifyError({ status: 401 }), 'cookie_expired');
  assert.equal(dh.classifyError({ status: 403 }), 'cookie_expired');
  assert.equal(dh.classifyError(new Error('device reads unavailable')), 'no_creds');
});

test('classifyError: network / timeout / abort all bucket to network (U-3)', () => {
  assert.equal(dh.classifyError(new Error('Network request failed')), 'network');
  assert.equal(dh.classifyError(new Error('device read timeout')), 'network');
  assert.equal(dh.classifyError(new Error('The operation was aborted')), 'network');
});

test('classifyError: other buckets', () => {
  assert.equal(dh.classifyError({ status: 429 }), 'rate_limited');
  assert.equal(dh.classifyError(new Error('device exposure incomplete — falling back')), 'incomplete');
  assert.equal(dh.classifyError({ status: 500, message: 'boom' }), 'http_500');
  assert.equal(dh.classifyError(null), 'error');
});

test('offline cooldown: a network failure suppresses device reads + beacons briefly (U-3)', () => {
  dh._reset();
  const t = 1_000_000;
  dh.noteResult('network', t);
  assert.equal(dh.deviceSuppressed(t + 1000), true, 'device suppressed during the cooldown');
  assert.equal(dh.shouldBeacon(t + 1000), false, 'no beacon during the cooldown (dead network)');
  assert.equal(dh.deviceSuppressed(t + dh.OFFLINE_COOLDOWN_MS + 1), false, 'device resumes after the cooldown');
  assert.equal(dh.shouldBeacon(t + dh.OFFLINE_COOLDOWN_MS + 1), true, 'beacons resume after the cooldown');
});

test('a success clears the cooldown early (connectivity is back)', () => {
  dh._reset();
  const t = 2_000_000;
  dh.noteResult('network', t);
  assert.equal(dh.deviceSuppressed(t + 100), true);
  dh.noteResult(null, t + 100); // a device read succeeded
  assert.equal(dh.deviceSuppressed(t + 200), false, 'a success reopens device reads immediately');
});

test('a non-network failure does not suppress device reads', () => {
  dh._reset();
  const t = 3_000_000;
  dh.noteResult('cookie_expired', t);
  assert.equal(dh.deviceSuppressed(t + 100), false, 'an expired cookie is handled by refresh, not the offline gate');
  dh.noteResult('rate_limited', t);
  assert.equal(dh.deviceSuppressed(t + 100), false);
});
