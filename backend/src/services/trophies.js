'use strict';

// Trophy case service — the owner's championships across leagues and seasons. Manual entry today
// (validated add/remove over a durable store); a future pass can auto-detect titles from MFL's
// playoffBrackets across past seasons and add them with source:'auto'. Demo seeds a few trophies so
// the case isn't empty.

const config = require('../config');
const demo = require('../demo/fixtures');
const trophyStore = require('../store/trophies');
const leaguesService = require('./leagues');
const playoffsService = require('./playoffs');

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
  // Podium finish: 1 = champion (gold), 2 = runner-up (silver), 3 = third (bronze). Anything missing or
  // out of range defaults to a championship, so an old client that never sends `place` keeps working.
  let place = parseInt(p.place, 10);
  if (!Number.isInteger(place) || place < 1 || place > 3) place = 1;
  if (!team) throwBad('A team name is required.');
  if (!leagueName) throwBad('A league name is required.');
  if (!Number.isInteger(year) || year < MIN_YEAR || year > maxYear()) {
    throwBad(`Enter a valid year (${MIN_YEAR}–${maxYear()}).`);
  }
  return {
    team: team.slice(0, 80),
    leagueName: leagueName.slice(0, 80),
    year,
    place,
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
  // Newest first; within a year the higher finish (champion → 3rd) leads.
  const trophies = trophyStore
    .list(token)
    .sort((a, b) => (b.year || 0) - (a.year || 0) || ((a.place || 1) - (b.place || 1)));
  const years = trophies.map((t) => t.year).filter(Boolean);
  const byPlace = (n) => trophies.filter((t) => (t.place || 1) === n).length;
  return {
    trophies,
    summary: {
      total: trophies.length,
      // Broken out by podium finish so callers can show championships distinctly from silver/bronze
      // (e.g. the Profile résumé counts titles only, not every podium finish).
      titles: byPlace(1),
      silver: byPlace(2),
      bronze: byPlace(3),
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
  const playoffs = playoffsService;
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
      // Per-league isolation: one league's scan must never reject the whole Promise.all and blank the
      // entire case (the C5 quiet-degradation contract). championFor is already fail-soft, so this is
      // belt-and-suspenders, but it also protects against any future non-fail-soft read added here.
      try {
        const titles = [];
        const mine = String(league.franchiseId);
        const record = (year, place) => titles.push({ leagueId: league.leagueId, leagueName: league.name, team: league.franchiseName || `Team ${mine}`, year, place });
        for (let year = thisSeason - 1; year >= thisSeason - back; year -= 1) {
          const res = await playoffs.championFor(cookie, league, String(year));
          if (!res.exists) break; // no bracket that year → league predates it; stop scanning back
          // A franchise finishes in exactly ONE podium slot per season — check gold → silver → bronze and
          // stop at the first that's mine, so a season yields at most one trophy.
          if (res.champion && String(res.champion.franchiseId) === mine) record(year, 1);
          else if (res.runnerUp && String(res.runnerUp.franchiseId) === mine) record(year, 2);
          else if (res.third && String(res.third.franchiseId) === mine) record(year, 3);
        }
        return titles;
      } catch (e) {
        console.log(`[trophies] detect league=${league.leagueId} error=${e.message}`);
        return [];
      }
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
