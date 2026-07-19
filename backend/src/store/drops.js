'use strict';

// Remembers players the user has dropped, per session token + league, so the
// player hub reflects "dropped" state immediately in demo mode. (Live mode issues
// a real MFL drop; this is the optimistic local mirror.) Durable via store/persist.

const persist = require('./persist');

const db = () => persist.ns('drops'); // token -> { 'leagueId:playerId' -> true }
const key = (leagueId, playerId) => `${leagueId}:${playerId}`;

function set(token, leagueId, playerId) {
  const d = db();
  if (!d[token]) d[token] = {};
  d[token][key(leagueId, playerId)] = true;
  persist.touch();
}

function has(token, leagueId, playerId) {
  const d = db();
  return !!(d[token] && d[token][key(leagueId, playerId)]);
}

module.exports = { set, has };
