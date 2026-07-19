'use strict';

// Remembers lineups the user has applied, keyed by session token + league, so the
// app reflects "set" state immediately. In DEMO mode this is the source of truth
// (there's no real MFL to write to); in LIVE mode it's a UI-optimistic cache on
// top of the real MFL submission. Durable via store/persist so it survives a restart.

const persist = require('./persist');

const db = () => persist.ns('lineups'); // 'token:leagueId' -> string[] starter ids
const key = (token, leagueId) => `${token}:${leagueId}`;

function set(token, leagueId, starterIds) {
  db()[key(token, leagueId)] = starterIds.slice();
  persist.touch();
}

function get(token, leagueId) {
  return db()[key(token, leagueId)] || null;
}

module.exports = { set, get };
