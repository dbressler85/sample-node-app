'use strict';

// Pure, framework-free heart of the cache layer — the survive-remount + throttle store the
// React hook (useCachedResource) is thin glue over. Kept dependency-free (no React, no
// AsyncStorage) on purpose so it's unit-testable with node:test and encodes the protected UX
// contracts explicitly (see docs/UX_GUARDRAILS.md):
//
//   C1 instant paint       — peek(key) returns the value synchronously, so a remount paints
//                            from memory with no blank frame.
//   C2 throttle            — isStale(key, staleMs, now) gates the refetch; a quick return
//                            within the window reads memory and does NOT hit the network.
//   C3 reflect-after-write — markAllStale() (fired after any mutation) forces the next read to
//                            refetch, but KEEPS the values so the paint is still instant.
//   C11 logout wipe        — clear() drops everything so the next account sees nothing stale.
//
// A key's entry is { value, at }. `at` is the last-fetched time in ms; `at === 0` is the
// "invalidated / definitely stale" marker (in production `Date.now() - 0` always exceeds any
// window). Callers pass an explicit `now` in tests to stay deterministic.

const mem = new Map(); // key -> { value, at }
const now = () => Date.now();

function has(key) {
  return mem.has(key);
}

function peek(key) {
  return mem.get(key);
}

// Store a value. `at` defaults to now; pass `0` to store-but-mark-stale (e.g. a disk-cache
// paint that should still trigger a background refetch).
function prime(key, value, at) {
  mem.set(key, { value, at: at == null ? now() : at });
}

// Stale when there's no entry, it was invalidated (at:0), or it's older than the window.
function isStale(key, staleMs, nowMs = now()) {
  const hit = mem.get(key);
  return !hit || nowMs - hit.at > staleMs;
}

// After any write, mark every snapshot stale — values stay (instant paint) but the next
// mount refetches so post-action screens aren't stale.
function markAllStale() {
  for (const v of mem.values()) v.at = 0;
}

function clear() {
  mem.clear();
}

function size() {
  return mem.size;
}

module.exports = { has, peek, prime, isStale, markAllStale, clear, size };
