'use strict';

// The player watchlist: a per-session-token list of MFL player ids the owner is
// tracking across all their leagues. Durable via store/persist so stars survive a
// restart. Newest-first (a just-starred player shows at the top).

const persist = require('./persist');

const db = () => persist.ns('watchlist'); // token -> [playerId]

function list(token) {
  const d = db();
  return d[token] ? [...d[token]] : [];
}

function has(token, playerId) {
  const d = db();
  return !!(d[token] && d[token].includes(String(playerId)));
}

function add(token, playerId) {
  const d = db();
  const id = String(playerId);
  if (!d[token]) d[token] = [];
  if (!d[token].includes(id)) {
    d[token].unshift(id);
    persist.touch();
  }
  return true;
}

function remove(token, playerId) {
  const d = db();
  const id = String(playerId);
  if (d[token]) {
    const i = d[token].indexOf(id);
    if (i >= 0) {
      d[token].splice(i, 1);
      persist.touch();
    }
  }
  return true;
}

module.exports = { list, has, add, remove };
