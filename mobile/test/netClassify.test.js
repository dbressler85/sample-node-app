'use strict';

// Unit tests for the cellular classifier (src/netClassify.js) — the U-2 gate for frugal prefetch. Split
// from net.js precisely so this is testable without the expo-network native module. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const { isCellularState } = require('../src/netClassify');

test('a connected cellular link is cellular', () => {
  assert.equal(isCellularState({ type: 'CELLULAR', isConnected: true }), true);
  assert.equal(isCellularState({ type: 'CELLULAR' }), true, 'isConnected undefined is treated as connected');
});

test('wifi / disconnected cellular / unknown are NOT cellular (fail-open — never over-restrict)', () => {
  assert.equal(isCellularState({ type: 'WIFI', isConnected: true }), false);
  assert.equal(isCellularState({ type: 'CELLULAR', isConnected: false }), false, 'a disconnected cellular link does not restrict');
  assert.equal(isCellularState({ type: undefined }), false);
  assert.equal(isCellularState(null), false);
  assert.equal(isCellularState(undefined), false);
});
