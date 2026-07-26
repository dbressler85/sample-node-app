'use strict';

// Bounded-concurrency + lightly-staggered async map — the device-side politeness the MFL terms require
// (docs/DEVICE_ORIGIN_MFL.md cost #3; review item A-1). A device-origin fan-out across 15-20 leagues used
// a bare Promise.all, firing every league (and pickInventory's 3 reads/league → 45-60 requests) at MFL
// simultaneously from the user's own IP — the burst that provokes a self-429. This mirrors the backend's
// own throttle shape (≤4 concurrent, ~150ms stagger) WITHOUT a per-call ~1s sleep (which would make the
// Sunday fan-out feel slower — the PO's explicit warning): a small concurrency cap keeps first paint fast
// while staying polite.
//
// Preserves input order in the result. Rejects on the first error, so callers keep their existing
// all-or-nothing → backend-fallback semantics (partial-tolerance is a separate item, A-2). Pure and
// dependency-free (injectable `sleep`) so the concurrency/stagger logic is unit-tested off-device.

const realSleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

async function poolMap(items, fn, { concurrency = 4, staggerMs = 150, sleep = realSleep } = {}) {
  const list = items || [];
  const results = new Array(list.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, list.length));

  async function worker(slot) {
    // Offset each worker's start so the first wave doesn't all leave at once.
    if (slot > 0) await sleep(slot * staggerMs);
    // Pull the next index until the queue drains; space this worker's successive requests.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const i = next;
      next += 1;
      if (i >= list.length) return;
      if (i >= workerCount) await sleep(staggerMs);
      results[i] = await fn(list[i], i);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, (_, s) => worker(s)));
  return results;
}

module.exports = poolMap;
