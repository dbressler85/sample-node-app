'use strict';

// Resilience cache for the BACKEND-supplied enrichment dictionaries the "device assembles" (Shape A) reads
// depend on — the franchise directory, the player lookup, and the exposure enrichment. It's the ONLY backend
// call left in those reads: the per-user roster/standings/transactions data already comes straight from MFL
// on the device's own IP, so if we also remember the (slow-changing, mostly public) enrichment, a Shape-A
// read can complete even when OUR backend is DOWN (docs/ARCHITECTURE_REVIEW_2026-07-device-origin.md U-4 —
// the 11:50am "Render is redeploying" moment).
//
// Cache-through: ALWAYS try the backend first; on success remember the value + return it fresh; on backend
// FAILURE, serve the last remembered value tagged `_stale`. It is NOT a freshness cache (deviceReadCache
// already coalesces online reads) — purely a last-known-good fallback for when the backend can't be reached.
// In-memory, so it covers a mid-session outage (the app is warm on a Sunday); a cold launch DURING an outage
// still can't conjure data it never fetched (documented follow-up: persist it). Cleared on logout/auth-loss
// (C11) — the exposure enrichment carries personal tag/watched, so it must not survive an account switch.

const mem = new Map(); // key -> last successful value

async function through(key, fetcher) {
  try {
    const fresh = await fetcher();
    mem.set(key, fresh);
    return fresh;
  } catch (e) {
    if (mem.has(key)) return { ...mem.get(key), _stale: true }; // backend unreachable → last-known (U-4)
    throw e; // never fetched it → can't help; the caller falls back to the backend (which is also down)
  }
}

// Slow-changing league metadata (names / mine / playoff spots / format).
const directory = (leagueId, fetcher) => through(`dir:${leagueId}`, fetcher);
// Player dictionary (name / position / team / value) for a league's ids.
const players = (leagueId, fetcher) => through(`plk:${leagueId}`, fetcher);
// Cross-league exposure enrichment (+ personal tag / watched).
const exposureEnrich = (leagueId, fetcher) => through(`exp:${leagueId}`, fetcher);

function clear() { mem.clear(); }
function size() { return mem.size; }

module.exports = { through, directory, players, exposureEnrich, clear, size };
