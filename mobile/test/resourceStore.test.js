'use strict';

// Acceptance tests for the PROTECTED UX CONTRACTS (docs/UX_GUARDRAILS.md), pinned at the pure
// store level so any future cache change (react-query or otherwise) must keep them green. These
// are the net the guardrails require before the Phase 1 nav/cache refactor. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/resourceStore');

test('C1 — instant paint: a primed value is peekable synchronously', () => {
  store.clear();
  store.prime('k', { n: 1 }, 1000);
  assert.equal(store.has('k'), true, 'has() true right after prime');
  assert.deepEqual(store.peek('k').value, { n: 1 }, 'peek returns the value with no async step');
});

test('C2 — throttle: fresh within the window, stale after it, stale when absent', () => {
  store.clear();
  const NOW = 1_000_000_000; // realistic epoch-scale clock
  const WINDOW = 45_000;
  store.prime('k', 'v', NOW);
  assert.equal(store.isStale('k', WINDOW, NOW + 1_000), false, '1s later → fresh (no refetch on quick return)');
  assert.equal(store.isStale('k', WINDOW, NOW + 46_000), true, '46s later → stale (refetch)');
  assert.equal(store.isStale('missing', WINDOW, NOW), true, 'no entry → stale (cold load)');
});

test('C3 — reflect-after-write: markAllStale forces a refetch but keeps the values (instant paint)', () => {
  store.clear();
  const NOW = 1_000_000_000;
  const WINDOW = 45_000;
  store.prime('a', 1, NOW);
  store.prime('b', 2, NOW);
  assert.equal(store.isStale('a', WINDOW, NOW), false, 'fresh before the write');

  store.markAllStale(); // the api layer fires this after any successful mutation

  assert.equal(store.isStale('a', WINDOW, NOW), true, 'a is stale after a write → next view refetches');
  assert.equal(store.isStale('b', WINDOW, NOW), true, 'b is stale too (all snapshots invalidated)');
  assert.equal(store.peek('a').value, 1, 'value is retained so the paint is still instant');
});

test('C3b — a disk-primed value (at:0) is treated as stale but present', () => {
  store.clear();
  store.prime('k', 'from-disk', 0); // the cold-path disk paint stamps at:0
  assert.equal(store.peek('k').value, 'from-disk', 'present for an instant paint');
  assert.equal(store.isStale('k', 45_000, 1_000_000_000), true, 'but stale → background refetch fires');
});

test('C11 — logout wipe: clear() drops every entry', () => {
  store.prime('x', 1);
  store.prime('y', 2);
  assert.ok(store.size() >= 2);
  store.clear();
  assert.equal(store.has('x'), false);
  assert.equal(store.has('y'), false);
  assert.equal(store.size(), 0, 'nothing survives for the next account');
});
