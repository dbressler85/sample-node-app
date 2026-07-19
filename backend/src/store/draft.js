'use strict';

// In-memory draft picks per session token + league, seeded from demo fixtures so
// a draft can progress (make picks) in the demo. In live, MFL is the source of
// truth (draftResults) and this only records optimistic local picks between
// refreshes. Swap for a real store before hosting.

const store = new Map(); // token -> Map(leagueId -> pick[])

function leagueMap(token) {
  if (!store.has(token)) store.set(token, new Map());
  return store.get(token);
}

function ensure(token, leagueId, seed) {
  const m = leagueMap(token);
  if (!m.has(leagueId)) m.set(leagueId, (seed || []).map((p) => ({ ...p })));
  return m.get(leagueId);
}

function list(token, leagueId, seed) {
  return ensure(token, leagueId, seed);
}

function add(token, leagueId, seed, pick) {
  const arr = ensure(token, leagueId, seed);
  arr.push({ ...pick });
  return pick;
}

module.exports = { list, add };
