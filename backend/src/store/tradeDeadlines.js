'use strict';

// Per-owner, per-league trade deadline — entered manually, because MFL exposes no machine-readable
// trade-deadline field. Stored as a plain 'YYYY-MM-DD' date so On Deck can surface it as a real
// countdown. Token-keyed (the owner's own note), durable via store/persist. Mirrors playerTags /
// watchlist / tradebait.

const persist = require('./persist');

const db = () => persist.ns('tradeDeadlines'); // token -> { [leagueId]: 'YYYY-MM-DD' }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function all(token) {
  return { ...(db()[token] || {}) };
}

function get(token, leagueId) {
  return (db()[token] || {})[String(leagueId)] || null;
}

// Set the deadline (a 'YYYY-MM-DD' string), or clear it when the date is falsy / malformed.
// Returns the resulting value (or null when cleared).
function set(token, leagueId, date) {
  const d = db();
  if (!d[token]) d[token] = {};
  const id = String(leagueId);
  if (date && DATE_RE.test(String(date))) d[token][id] = String(date);
  else delete d[token][id];
  persist.touch();
  return d[token][id] || null;
}

module.exports = { all, get, set, DATE_RE };
