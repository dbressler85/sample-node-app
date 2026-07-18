'use strict';

// Remembers players the user has dropped, per session token + league, so the
// player hub reflects "dropped" state immediately in demo mode. (Live mode issues
// a real MFL drop; this is the optimistic local mirror.)

const dropped = new Map(); // token -> Set(`${leagueId}:${playerId}`)

const key = (leagueId, playerId) => `${leagueId}:${playerId}`;

function set(token, leagueId, playerId) {
  if (!dropped.has(token)) dropped.set(token, new Set());
  dropped.get(token).add(key(leagueId, playerId));
}

function has(token, leagueId, playerId) {
  return dropped.has(token) && dropped.get(token).has(key(leagueId, playerId));
}

module.exports = { set, has };
