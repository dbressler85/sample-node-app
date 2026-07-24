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
    source: p.source === 'auto' ? 'auto' : 'manual',
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

// Auto-detect championships from MFL playoff history. For each of the owner's leagues, scan past
// seasons (year-path) from the last completed one backwards, stopping at the first year the league
// ran no playoff bracket (it didn't exist yet — earlier years won't either). A season where the
// bracket champion is MY franchise is a title. Detection is deterministic (champion = the undefeated
// bracket team) and fail-soft per read, so a flaky season is skipped, not fatal. Returns candidates
// tagged with whether they're already in the case. Leagues scan in parallel; years within a league
// run in sequence so the early-stop can bound the work to each league's real lifespan.
const MAX_YEARS_BACK = 15;
async function detect(cookie, token, { yearsBack = 12 } = {}) {
  if (config.demoMode) return { candidates: [], summary: { found: 0, new: 0 }, demo: true };
  const playoffs = require('./playoffs'); // lazy — avoids a trophies↔playoffs require cycle
  const leaguesService = require('./leagues');
  const leagues = await leaguesService.listLeagues(cookie);
  const thisSeason = parseInt(config.season, 10) || new Date().getFullYear();
  const back = Math.min(Math.max(1, yearsBack), MAX_YEARS_BACK);

  const existing = new Set();
  for (const t of trophyStore.list(token)) {
    if (t.leagueId) existing.add(`${t.leagueId}|${t.year}`.toLowerCase());
    if (t.leagueName) existing.add(`${t.leagueName}|${t.year}`.toLowerCase());
  }

  const perLeague = await Promise.all(
    leagues.map(async (league) => {
      const titles = [];
      for (let year = thisSeason - 1; year >= thisSeason - back; year -= 1) {
        const res = await playoffs.championFor(cookie, league, String(year));
        if (!res.exists) break; // no bracket that year → league predates it; stop scanning back
        if (res.champion && String(res.champion.franchiseId) === String(league.franchiseId)) {
          titles.push({ leagueId: league.leagueId, leagueName: league.name, team: league.franchiseName || `Team ${league.franchiseId}`, year });
        }
      }
      return titles;
    })
  );

  const candidates = perLeague
    .flat()
    .sort((a, b) => b.year - a.year || String(a.leagueName).localeCompare(String(b.leagueName)))
    .map((c) => ({
      ...c,
      alreadyInCase: existing.has(`${c.leagueId}|${c.year}`.toLowerCase()) || existing.has(`${c.leagueName}|${c.year}`.toLowerCase()),
    }));
  return { candidates, summary: { found: candidates.length, new: candidates.filter((c) => !c.alreadyInCase).length } };
}

// Detect + add every NEW championship in one shot (source:'auto'), returning what was added plus the
// refreshed case. The one-tap "find my titles" action; anything mis-detected is reversible (remove).
async function detectAndAdd(cookie, token, opts) {
  const { candidates } = await detect(cookie, token, opts);
  const fresh = candidates.filter((c) => !c.alreadyInCase);
  const added = fresh.map((c) => trophyStore.add(token, normalize({ ...c, source: 'auto' })));
  return { added, scanned: candidates.length, ...list(token) };
}

module.exports = { list, add, remove, detect, detectAndAdd };
