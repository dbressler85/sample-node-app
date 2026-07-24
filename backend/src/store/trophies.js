'use strict';

// The trophy case: championships the owner has won, across every league and past season. Each
// trophy carries the team name, league name, and the year won (plus an optional leagueId and a
// `source` of 'manual' or 'auto' for a future MFL auto-detect layer). Durable via store/persist so
// the case survives restarts. Stored newest-year-first.

const crypto = require('crypto');
const persist = require('./persist');

const db = () => persist.ns('trophies'); // token -> [trophy]

function list(token) {
  const d = db();
  return d[token] ? d[token].map((t) => ({ ...t })) : [];
}

// Add a trophy. `trophy` is a validated { leagueId?, leagueName, team, year, source } — the caller
// (service) does the validation. Deduped on (leagueId|leagueName, year) so the same title can't be
// added twice; returns the stored row (existing one on a dup).
function add(token, trophy) {
  const d = db();
  if (!d[token]) d[token] = [];
  // Dedup across BOTH id and name keys so an auto-detected title (has leagueId) doesn't duplicate a
  // manually-entered one (leagueId null, same league name + year), and vice-versa.
  const keys = (t) => [`${t.leagueId || ''}|${t.year}`.toLowerCase(), `${t.leagueName || ''}|${t.year}`.toLowerCase()].filter((k) => !k.startsWith('|'));
  const wanted = new Set(keys(trophy));
  const existing = d[token].find((t) => keys(t).some((k) => wanted.has(k)));
  if (existing) return { ...existing };
  const row = { id: crypto.randomUUID(), source: 'manual', ...trophy };
  d[token].push(row);
  d[token].sort((a, b) => (b.year || 0) - (a.year || 0));
  persist.touch();
  return { ...row };
}

function remove(token, id) {
  const d = db();
  if (!d[token]) return false;
  const i = d[token].findIndex((t) => t.id === id);
  if (i < 0) return false;
  d[token].splice(i, 1);
  persist.touch();
  return true;
}

module.exports = { list, add, remove };
