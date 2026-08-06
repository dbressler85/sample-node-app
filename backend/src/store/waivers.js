'use strict';

// Pending waiver/FA claims per session token + league, seeded lazily from demo
// fixtures, then reflecting submits/cancels. Durable via store/persist so queued
// claims survive a restart (in live it's the optimistic mirror of MFL).

const persist = require('./persist');

const db = () => persist.ns('waivers'); // token -> { leagueId -> claim[] }
const meta = () => persist.ns('meta');

function nextId(key, start) {
  const m = meta();
  const cur = m[key] != null ? m[key] : start;
  m[key] = cur + 1;
  return cur;
}

function ensure(token, leagueId, seed) {
  const d = db();
  if (!d[token]) d[token] = {};
  if (!d[token][leagueId]) {
    d[token][leagueId] = (seed || []).map((c, i) => ({ id: c.id || `seed-${leagueId}-${i}`, ...c }));
    persist.touch();
  }
  return d[token][leagueId];
}

function list(token, leagueId, seed) {
  return ensure(token, leagueId, seed);
}

function add(token, leagueId, seed, claim) {
  const arr = ensure(token, leagueId, seed);
  const withId = { id: `c${nextId('waiverCounter', 1000)}`, ...claim };
  arr.push(withId);
  persist.touch();
  return withId;
}

// Patch an existing claim in place (merge `patch` into it) — used to edit a queued claim's bid/drop
// without changing its id or queue position. Returns the updated claim, or null if not found.
function update(token, leagueId, seed, claimId, patch) {
  const arr = ensure(token, leagueId, seed);
  const c = arr.find((x) => String(x.id) === String(claimId));
  if (!c) return null;
  Object.assign(c, patch);
  persist.touch();
  return c;
}

function remove(token, leagueId, seed, claimId) {
  const arr = ensure(token, leagueId, seed);
  const i = arr.findIndex((c) => String(c.id) === String(claimId));
  if (i < 0) return null;
  const [removed] = arr.splice(i, 1);
  persist.touch();
  return removed;
}

// Reorder the queue to match `orderedIds` (a desired sequence of claim ids). Claims not named in
// the list keep their relative order and sink to the bottom — so a partial/stale order never drops
// a claim. Stable sort preserves that. Returns the reordered array.
function reorder(token, leagueId, seed, orderedIds) {
  const arr = ensure(token, leagueId, seed);
  const rank = new Map((orderedIds || []).map((id, i) => [String(id), i]));
  const at = (c) => (rank.has(String(c.id)) ? rank.get(String(c.id)) : Number.POSITIVE_INFINITY);
  arr.sort((a, b) => at(a) - at(b));
  persist.touch();
  return arr;
}

module.exports = { list, add, update, remove, reorder };
