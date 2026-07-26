'use strict';

// Session-scoped read cache for DEVICE-ORIGIN MFL reads — the device counterpart to the backend's
// shared readCache (backend/src/lib/mfl.js). Device-origin gives up the backend's CROSS-USER cache:
// there, one fetch of `rosters` serves every member of a league (the cookie is dropped from the key);
// on the device each user fetches their own copy. Without a device-side cache the SAME read is then
// re-fetched by every screen that needs it (rosters feeds the Rosters tab, Exposure, and Portfolio) and
// on every remount — strictly LESS efficient than the backend it replaced.
//
// This restores that coalescing WITHOUT touching freshness: keyed by type+league+params; TTL MATCHED to
// the backend tier (staleness tolerance is a property of the DATA, not where it's fetched); the in-flight
// PROMISE is cached so concurrent consumers share ONE fetch; a rejected read is evicted so failures are
// never cached; and any write clears the whole cache (wired to invalidateCaches in mflDevice, mirroring
// the backend's invalidate-on-write). Pure + framework-free (injectable clock) so the TTL / key / coalesce
// logic is unit-tested (test/deviceReadCache.test.js) even though the device path itself is build-verified.

// Per-read-type TTL, matched to lib/mfl.js's tiers: 5m default (rosters / leagueStandings / transactions),
// draftResults 12s (live-polled during a draft), calendar 1h (waiver/lock windows, ~daily).
const TTL_MS = {
  rosters: 5 * 60 * 1000,
  leagueStandings: 5 * 60 * 1000,
  transactions: 5 * 60 * 1000,
  draftResults: 12 * 1000,
  calendar: 60 * 60 * 1000,
};
const DEFAULT_TTL_MS = 5 * 60 * 1000;

const mem = new Map(); // key -> { at, ttl, promise }
const clock = () => Date.now();

// type + league + SORTED params (so {L,FRANCHISE} and {FRANCHISE,L} don't split the entry, and an
// all-franchise rosters read shares a key with itself across Portfolio/Rosters while FRANCHISE=me is its
// own entry).
function key(type, leagueId, params) {
  const p = params && Object.keys(params).length ? JSON.stringify(params, Object.keys(params).sort()) : '';
  return `${type}|${leagueId == null ? '' : leagueId}|${p}`;
}

const ttlFor = (type) => (TTL_MS[type] != null ? TTL_MS[type] : DEFAULT_TTL_MS);

// Return the cached (still-fresh) promise for a read, else run `fetcher()` and cache its promise. A
// rejected fetch evicts its entry so the next call retries (never a cached failure). `nowMs` is injectable
// for deterministic tests.
function get(type, leagueId, params, fetcher, nowMs = clock()) {
  const k = key(type, leagueId, params);
  const hit = mem.get(k);
  if (hit && nowMs - hit.at < hit.ttl) return hit.promise;
  const promise = Promise.resolve().then(fetcher).catch((e) => {
    const cur = mem.get(k);
    if (cur && cur.promise === promise) mem.delete(k);
    throw e;
  });
  mem.set(k, { at: nowMs, ttl: ttlFor(type), promise });
  return promise;
}

function clear() {
  mem.clear();
}
function size() {
  return mem.size;
}

module.exports = { get, clear, size, key, ttlFor, TTL_MS, DEFAULT_TTL_MS };
