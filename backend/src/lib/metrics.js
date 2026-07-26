'use strict';

// Lightweight in-process metrics for the MFL data layer — so the caching / throttle / warm work is
// MEASURABLE instead of guessed at. Pure counters with no dependencies (mfl.js records into it; the
// /_metrics route reads a snapshot), so there's no import cycle. Resets on restart — this is a live
// operational view, not a historical store.

const counters = {
  fetches: 0, // actual outbound MFL network calls (every rawRequest attempt)
  cacheHits: 0, // exportRequest served from the read cache
  cacheMisses: 0, // exportRequest had to fetch
  sharedHits: 0, // a hit on a cross-user (league-global) cache entry
  privateHits: 0, // a hit on a per-session entry
  http429: 0, // rate-limited responses
  http503: 0, // transient server errors
  errors: 0, // other failed fetches
};

// Per-export-type fetch counts, so you can see WHAT is driving MFL volume (rosters vs projections …).
const byType = new Map(); // type -> fetches
// Device-origin reads: how often each read was served BY THE DEVICE (fetched straight from MFL) vs.
// fell back to the BACKEND. The whole point of device-origin is moving per-user fan-outs off the
// shared IP, so this is the number that says whether it's working (high device %, per read).
const deviceReads = new Map(); // read -> { device, backend }
// Fetch timestamps within the last window, for a rolling calls/min figure.
const recent = [];
const WINDOW_MS = 5 * 60 * 1000;

function trim(now) {
  const cut = now - WINDOW_MS;
  while (recent.length && recent[0] < cut) recent.shift();
}

function recordFetch(type) {
  counters.fetches += 1;
  const now = Date.now();
  recent.push(now);
  trim(now);
  const t = type || '(other)';
  byType.set(t, (byType.get(t) || 0) + 1);
}
function recordHit(shared) {
  counters.cacheHits += 1;
  if (shared) counters.sharedHits += 1;
  else counters.privateHits += 1;
}
// A device reported that it served `read` from the `device` path or fell back to the `backend`.
function recordDeviceRead(read, source) {
  const key = String(read || 'unknown');
  const e = deviceReads.get(key) || { device: 0, backend: 0 };
  if (source === 'device') e.device += 1;
  else e.backend += 1;
  deviceReads.set(key, e);
}
const recordMiss = () => { counters.cacheMisses += 1; };
const record429 = () => { counters.http429 += 1; };
const record503 = () => { counters.http503 += 1; };
const recordError = () => { counters.errors += 1; };
const fetchCount = () => counters.fetches;

function callsPerMin() {
  const now = Date.now();
  trim(now);
  return recent.filter((t) => t >= now - 60 * 1000).length;
}

function snapshot() {
  const reqs = counters.cacheHits + counters.cacheMisses;
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  const top = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([type, fetches]) => ({ type, fetches }));
  return {
    ...counters,
    cacheableRequests: reqs,
    hitRatePct: pct(counters.cacheHits, reqs), // % of cacheable reads served without an MFL call
    sharedHitPct: pct(counters.sharedHits, counters.cacheHits), // of hits, how many were cross-user
    callsPerMin: callsPerMin(),
    callsLast5Min: recent.length,
    topTypes: top,
    deviceReads: [...deviceReads.entries()].map(([read, c]) => ({ read, device: c.device, backend: c.backend, devicePct: pct(c.device, c.device + c.backend) })),
  };
}

// Test-only reset so a harness starts clean.
function _reset() {
  for (const k of Object.keys(counters)) counters[k] = 0;
  byType.clear();
  deviceReads.clear();
  recent.length = 0;
}

module.exports = { recordFetch, recordHit, recordMiss, record429, record503, recordError, recordDeviceRead, fetchCount, snapshot, _reset };
