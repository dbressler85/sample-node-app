'use strict';

// Remembers lineups the user has applied, keyed by session token + league, so the
// app reflects "set" state immediately. In DEMO mode this is the source of truth
// (there's no real MFL to write to); in LIVE mode it's just a UI-optimistic cache
// on top of the real MFL submission.

const applied = new Map(); // `${token}:${leagueId}` -> string[] starter ids

const key = (token, leagueId) => `${token}:${leagueId}`;

function set(token, leagueId, starterIds) {
  applied.set(key(token, leagueId), starterIds.slice());
}

function get(token, leagueId) {
  return applied.get(key(token, leagueId)) || null;
}

module.exports = { set, get };
