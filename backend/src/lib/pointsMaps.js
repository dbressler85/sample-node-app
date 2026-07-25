'use strict';

// Season-to-date fantasy points (YTD) and current-week projected points, as id→number maps for
// ONE league. MFL scores are LEAGUE-scoped (a player's points depend on that league's scoring
// rules), so these numbers are always "under this league's scoring". The Players screen surfaces
// them as a general, at-a-glance signal — computed against the owner's PRIMARY league so every tab
// shows a single consistent number (see the callers, which pass leagues[0]).
//
// Both come from full-league MFL exports (one call each covers EVERY player — no per-player
// fan-out), so this is two reads total, memoized per (cookie, leagueId, week) for a short TTL and
// shared across the search / rankings / free-agent / exposure surfaces that all want the same pair.

const config = require('../config');
const demo = require('../demo/fixtures');
const mflRepo = require('./mflRepo');
const scoringLib = require('./scoring');
const { createMemo } = require('./memo');

const memo = createMemo({ ttlMs: config.mflCacheTtlMs });
const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const EMPTY = { season: new Map(), proj: new Map() };

async function build(cookie, league, week) {
  if (config.demoMode) {
    const season = new Map();
    const proj = new Map();
    const scoring = demo.scoring(league.leagueId) || {};
    const stats = demo.statProjections();
    for (const p of demo.allPlayers()) {
      const id = String(p.id);
      // Season points: sum this player's completed-week game log (demo's stand-in for a YTD total).
      const log = demo.gameLog(id);
      if (log.length) season.set(id, r1(log.reduce((s, g) => s + (g.pts || 0), 0)));
      // Week projection: the same stat-line → points the lineups/waivers screens use.
      const st = stats[id];
      if (st) proj.set(id, r1(scoringLib.projectPoints(st, p.position, scoring)));
    }
    return { season, proj };
  }
  const inSeason = week >= 1 && week <= 18;
  const [ytd, prj] = await Promise.all([
    // Season total to date: YTD is a full-season fantasy total; meaningful in-season, empty between.
    mflRepo.playerScores(league, cookie, { W: 'YTD' }).catch(() => []),
    // Current-week projection only exists in-season; skip the call in the offseason.
    inSeason ? mflRepo.projectedScores(league, cookie, { W: week }).catch(() => []) : Promise.resolve([]),
  ]);
  const season = new Map();
  for (const p of ytd) {
    if (p && p.score !== '' && p.score != null) season.set(String(p.id), r1(p.score));
  }
  const proj = new Map();
  for (const p of prj) {
    if (p && p.score !== '' && p.score != null) proj.set(String(p.id), r1(p.score));
  }
  return { season, proj };
}

// The season + projection maps for a league, memoized. Fail-soft to empty maps (the two numbers are
// a nice-to-have on a row, never blocking). `league` may be null (no leagues yet) → empty.
async function maps(cookie, league, week) {
  if (!league) return EMPTY;
  try {
    return await memo.get(`${cookie}|${league.leagueId}|${week}`, () => build(cookie, league, week));
  } catch (e) {
    return EMPTY;
  }
}

module.exports = { maps };
