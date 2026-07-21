'use strict';

// Per-owner league preferences: PIN the leagues you care about — they sort to the top of
// every cross-league view. Durable via store/persist.

const persist = require('./persist');

const db = () => persist.ns('leaguePrefs'); // token -> { pinned: [leagueId] }

function get(token) {
  const e = db()[token] || {};
  return { pinned: (e.pinned || []).map(String) };
}

function ensure(token) {
  const d = db();
  if (!d[token]) d[token] = { pinned: [] };
  if (!d[token].pinned) d[token].pinned = [];
  return d[token];
}

function toggle(list, id, on) {
  const i = list.indexOf(id);
  if (on && i < 0) list.push(id);
  else if (!on && i >= 0) list.splice(i, 1);
}

function setPin(token, leagueId, on) {
  const e = ensure(token);
  const id = String(leagueId);
  toggle(e.pinned, id, on);
  persist.touch();
  return true;
}

module.exports = { get, setPin };
