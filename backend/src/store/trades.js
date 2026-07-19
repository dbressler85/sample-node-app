'use strict';

// Trade offers per session token + league, seeded lazily from demo fixtures, then
// reflecting responds (accept/reject) and proposals (outgoing offers). Durable via
// store/persist so offers survive a restart (in live it mirrors MFL pendingTrades).

const persist = require('./persist');

const db = () => persist.ns('trades'); // token -> { leagueId -> offer[] }
const meta = () => persist.ns('meta');

function nextId(key, start) {
  const m = meta();
  const cur = m[key] != null ? m[key] : start;
  m[key] = cur + 1;
  return cur;
}

function ensure(token, leagueId, seed) {
  const d = db();
  if (!d[token]) d[token] = {};
  if (!d[token][leagueId]) {
    d[token][leagueId] = (seed || []).map((o, i) => ({ id: o.id || `seed-${leagueId}-${i}`, direction: 'incoming', status: 'pending', ...o }));
    persist.touch();
  }
  return d[token][leagueId];
}

function list(token, leagueId, seed) {
  return ensure(token, leagueId, seed);
}

function add(token, leagueId, seed, offer) {
  const arr = ensure(token, leagueId, seed);
  const withId = { id: `t${nextId('tradeCounter', 5000)}`, status: 'pending', ...offer };
  arr.push(withId);
  persist.touch();
  return withId;
}

// Mark an offer resolved (accepted/rejected) and return it.
function resolve(token, leagueId, seed, offerId, status) {
  const arr = ensure(token, leagueId, seed);
  const offer = arr.find((o) => String(o.id) === String(offerId));
  if (!offer) return null;
  offer.status = status;
  persist.touch();
  return offer;
}

module.exports = { list, add, resolve };
