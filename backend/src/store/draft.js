'use strict';

// Draft picks per session token + league, seeded from demo fixtures so a draft
// can progress (make picks) in the demo. In live, MFL is the source of truth
// (draftResults) and this records optimistic local picks between refreshes.
// Durable via store/persist so picks survive a restart.

const persist = require('./persist');

const db = () => persist.ns('draft'); // token -> { leagueId -> pick[] }

function ensure(token, leagueId, seed) {
  const d = db();
  if (!d[token]) d[token] = {};
  if (!d[token][leagueId]) {
    d[token][leagueId] = (seed || []).map((p) => ({ ...p }));
    persist.touch();
  }
  return d[token][leagueId];
}

function list(token, leagueId, seed) {
  return ensure(token, leagueId, seed);
}

function add(token, leagueId, seed, pick) {
  const arr = ensure(token, leagueId, seed);
  arr.push({ ...pick });
  persist.touch();
  return pick;
}

module.exports = { list, add };
