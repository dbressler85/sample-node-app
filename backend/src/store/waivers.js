'use strict';

// In-memory pending waiver/FA claims per session token + league. Seeded lazily
// from demo fixtures so the app starts with realistic pending claims, then
// reflects submits/cancels. Swap for a real store before hosting (like sessions).

let counter = 1000;
const store = new Map(); // token -> Map(leagueId -> claim[])

function leagueMap(token) {
  if (!store.has(token)) store.set(token, new Map());
  return store.get(token);
}

// Return this token+league's claim list, initializing from `seed` the first time.
function ensure(token, leagueId, seed) {
  const m = leagueMap(token);
  if (!m.has(leagueId)) {
    m.set(
      leagueId,
      (seed || []).map((c, i) => ({ id: c.id || `seed-${leagueId}-${i}`, ...c }))
    );
  }
  return m.get(leagueId);
}

function list(token, leagueId, seed) {
  return ensure(token, leagueId, seed);
}

function add(token, leagueId, seed, claim) {
  const arr = ensure(token, leagueId, seed);
  const withId = { id: `c${counter++}`, ...claim };
  arr.push(withId);
  return withId;
}

function remove(token, leagueId, seed, claimId) {
  const arr = ensure(token, leagueId, seed);
  const i = arr.findIndex((c) => String(c.id) === String(claimId));
  if (i < 0) return null;
  return arr.splice(i, 1)[0];
}

module.exports = { list, add, remove };
