'use strict';

// Unit tests for the device fan-out limiter (src/poolMap.js) — the A-1 politeness fix. Pins: it never
// exceeds the concurrency cap, preserves input order, runs every item, and rejects on the first error
// (so callers keep their backend-fallback semantics). Injectable `sleep` keeps it deterministic. Run: npm test.

const test = require('node:test');
const assert = require('node:assert');
const poolMap = require('../src/poolMap');

const noSleep = () => Promise.resolve();

test('never exceeds the concurrency cap and preserves order + coverage', async () => {
  let inFlight = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const out = await poolMap(items, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await Promise.resolve(); // yield so overlapping calls actually overlap
    inFlight -= 1;
    return n * 2;
  }, { concurrency: 4, staggerMs: 0, sleep: noSleep });
  assert.ok(peak <= 4, `peak concurrency ${peak} exceeded the cap of 4`);
  assert.deepEqual(out, items.map((n) => n * 2), 'results are in input order');
  assert.equal(out.length, 20, 'every item ran');
});

test('cap is clamped to the item count for tiny lists', async () => {
  let peak = 0;
  let inFlight = 0;
  const out = await poolMap([1, 2], async (n) => {
    inFlight += 1; peak = Math.max(peak, inFlight); await Promise.resolve(); inFlight -= 1; return n;
  }, { concurrency: 8, staggerMs: 0, sleep: noSleep });
  assert.ok(peak <= 2, `peak ${peak} exceeded the 2-item list`);
  assert.deepEqual(out, [1, 2]);
});

test('rejects on the first error (all-or-nothing → caller falls back)', async () => {
  await assert.rejects(
    () => poolMap([1, 2, 3], async (n) => { if (n === 2) throw new Error('boom'); return n; }, { concurrency: 2, staggerMs: 0, sleep: noSleep }),
    /boom/,
  );
});

test('empty list is a no-op', async () => {
  assert.deepEqual(await poolMap([], async () => 1, { sleep: noSleep }), []);
});

test('staggers via the injected sleep (spacing requested, not a per-call 1s block)', async () => {
  const sleeps = [];
  const sleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };
  await poolMap([1, 2, 3, 4, 5, 6], async (n) => n, { concurrency: 2, staggerMs: 150, sleep });
  assert.ok(sleeps.length > 0, 'stagger was applied');
  assert.ok(sleeps.every((ms) => ms <= 300), `no per-call sleep exceeded a small stagger, got ${JSON.stringify(sleeps)}`);
});
