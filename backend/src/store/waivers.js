'use strict';

// Pending waiver/FA claims per session token + league, seeded lazily from demo
// fixtures, then reflecting submits/cancels. Durable via store/persist so queued
// claims survive a restart (in live it's the optimistic mirror of MFL).

const persist = require('./persist');

const db = () => persist.ns('waivers'); // token -> { leagueId -> claim[] }
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
    d[token][leagueId] = (seed || []).map((c, i) => ({ id: c.id || `seed-${leagueId}-${i}`, ...c }));
    persist.touch();
  }
  return d[token][leagueId];
}

function list(token, leagueId, seed) {
  return ensure(token, leagueId, seed);
}

function add(token, leagueId, seed, claim) {
  const arr = ensure(token, leagueId, seed);
  const withId = { id: `c${nextId('waiverCounter', 1000)}`, ...claim };
  arr.push(withId);
  persist.touch();
  return withId;
}

function remove(token, leagueId, seed, claimId) {
  const arr = ensure(token, leagueId, seed);
  const i = arr.findIndex((c) => String(c.id) === String(claimId));
  if (i < 0) return null;
  const [removed] = arr.splice(i, 1);
  persist.touch();
  return removed;
}

module.exports = { list, add, remove };
