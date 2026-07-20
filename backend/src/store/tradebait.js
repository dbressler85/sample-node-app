'use strict';

// Trade bait: the players you're actively shopping, managed in one place across all
// your leagues. Unlike the watchlist (a flat set of player ids you're tracking), bait
// is scoped to a (leagueId, playerId) pair — you own a specific asset in a specific
// league and want to move HIM THERE, optionally with a note (asking price / target).
// Durable via store/persist so the block survives a restart. Newest-first.

const persist = require('./persist');

const db = () => persist.ns('tradebait'); // token -> [{ leagueId, playerId, note, at }]

function list(token) {
  const d = db();
  return d[token] ? d[token].map((e) => ({ ...e })) : [];
}

// Player ids on the block in one league (for marking a roster view).
function listLeague(token, leagueId) {
  const d = db();
  const lid = String(leagueId);
  return (d[token] || []).filter((e) => e.leagueId === lid).map((e) => e.playerId);
}

function has(token, leagueId, playerId) {
  const d = db();
  const lid = String(leagueId);
  const pid = String(playerId);
  return !!(d[token] && d[token].some((e) => e.leagueId === lid && e.playerId === pid));
}

// Add (or update the note of) a player on the block. Idempotent per (league, player).
function add(token, leagueId, playerId, note) {
  const d = db();
  const lid = String(leagueId);
  const pid = String(playerId);
  if (!d[token]) d[token] = [];
  const existing = d[token].find((e) => e.leagueId === lid && e.playerId === pid);
  if (existing) {
    if (note !== undefined) existing.note = note || null;
  } else {
    d[token].unshift({ leagueId: lid, playerId: pid, note: note || null, at: Date.now() });
  }
  persist.touch();
  return true;
}

function remove(token, leagueId, playerId) {
  const d = db();
  const lid = String(leagueId);
  const pid = String(playerId);
  if (d[token]) {
    const i = d[token].findIndex((e) => e.leagueId === lid && e.playerId === pid);
    if (i >= 0) {
      d[token].splice(i, 1);
      persist.touch();
    }
  }
  return true;
}

module.exports = { list, listLeague, has, add, remove };
