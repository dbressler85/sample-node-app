'use strict';

// Trophy case service — the owner's championships across leagues and seasons. Manual entry today
// (validated add/remove over a durable store); a future pass can auto-detect titles from MFL's
// playoffBrackets across past seasons and add them with source:'auto'. Demo seeds a few trophies so
// the case isn't empty.

const config = require('../config');
const demo = require('../demo/fixtures');
const trophyStore = require('../store/trophies');

function throwBad(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

// Reasonable bounds: MFL/dynasty history doesn't predate the mid-90s, and a championship can't be
// from a future season. Keep the ceiling one year ahead of the configured season for safety.
const MIN_YEAR = 1990;
function maxYear() {
  return (parseInt(config.season, 10) || new Date().getFullYear()) + 1;
}

// Validate + normalize an incoming trophy payload into what the store keeps.
function normalize(payload) {
  const p = payload || {};
  const team = String(p.team || '').trim();
  const leagueName = String(p.leagueName || '').trim();
  const year = parseInt(p.year, 10);
  if (!team) throwBad('A team name is required.');
  if (!leagueName) throwBad('A league name is required.');
  if (!Number.isInteger(year) || year < MIN_YEAR || year > maxYear()) {
    throwBad(`Enter a valid championship year (${MIN_YEAR}–${maxYear()}).`);
  }
  return {
    team: team.slice(0, 80),
    leagueName: leagueName.slice(0, 80),
    year,
    leagueId: p.leagueId ? String(p.leagueId) : null,
    source: 'manual',
  };
}

// In demo, seed the store from the fixture on first read so add/remove behave like live (the fixture
// is the initial set, then the store is authoritative). A one-time seed per token.
const demoSeeded = new Set();
function ensureDemoSeed(token) {
  if (!config.demoMode || demoSeeded.has(token)) return;
  demoSeeded.add(token);
  if (trophyStore.list(token).length) return; // already has some (persisted) — don't double-seed
  for (const t of demo.trophies()) trophyStore.add(token, { ...t, source: 'auto' });
}

function list(token) {
  ensureDemoSeed(token);
  const trophies = trophyStore.list(token).sort((a, b) => (b.year || 0) - (a.year || 0));
  const years = trophies.map((t) => t.year).filter(Boolean);
  return {
    trophies,
    summary: {
      total: trophies.length,
      leagues: new Set(trophies.map((t) => t.leagueId || t.leagueName)).size,
      latest: years.length ? Math.max(...years) : null,
    },
  };
}

function add(token, payload) {
  ensureDemoSeed(token);
  const trophy = trophyStore.add(token, normalize(payload));
  return { trophy, ...list(token) };
}

function remove(token, id) {
  ensureDemoSeed(token);
  const ok = trophyStore.remove(token, id);
  if (!ok) {
    const err = new Error('Trophy not found');
    err.status = 404;
    throw err;
  }
  return { removed: id, ...list(token) };
}

module.exports = { list, add, remove };
