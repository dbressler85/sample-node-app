'use strict';

// Cross-league dashboard aggregation.
// For each league the account is in, produce a compact snapshot: this week's
// matchup, live score, record and standing. Per-league failures are isolated so
// one broken league never blanks the whole dashboard.

const mfl = require('../lib/mfl');
const config = require('../config');
const demo = require('../demo/fixtures');
const leaguesService = require('./leagues');

// --- live helpers (best-effort; MFL shapes vary, so each is defensive) -------

async function liveMatchup(league, cookie) {
  // liveScoring (no W) returns the current week's franchise scores.
  const res = await mfl.exportRequest('liveScoring', { host: league.host, cookie, L: league.leagueId });
  const live = res && res.liveScoring;
  const week = live ? Number(live.week) : null;
  const franchises = mfl.toArray(live && live.franchise);

  const scoreById = new Map();
  for (const f of franchises) scoreById.set(String(f.id), Number(f.score) || 0);

  // Find my matchup via the schedule for that week.
  let opponentId = null;
  try {
    const sched = await mfl.exportRequest('schedule', { host: league.host, cookie, L: league.leagueId, W: week });
    const weeks = mfl.toArray(sched && sched.schedule && sched.schedule.weeklySchedule);
    const wk = weeks.find((w) => Number(w.week) === week) || weeks[0];
    for (const m of mfl.toArray(wk && wk.matchup)) {
      const fr = mfl.toArray(m.franchise).map((x) => String(x.id));
      if (fr.includes(league.franchiseId)) {
        opponentId = fr.find((id) => id !== league.franchiseId) || null;
        break;
      }
    }
  } catch (e) {
    /* schedule is optional; fall through without an opponent */
  }

  return {
    week,
    me: { name: league.franchiseName || `Team ${league.franchiseId}`, score: scoreById.get(league.franchiseId) || 0 },
    opponent: opponentId
      ? { name: `Team ${opponentId}`, score: scoreById.get(opponentId) || 0 }
      : null,
  };
}

async function standing(league, cookie) {
  try {
    const res = await mfl.exportRequest('leagueStandings', { host: league.host, cookie, L: league.leagueId });
    const franchises = mfl.toArray(res && res.leagueStandings && res.leagueStandings.franchise);
    const idx = franchises.findIndex((f) => String(f.id) === league.franchiseId);
    const mine = idx >= 0 ? franchises[idx] : null;
    if (!mine) return { record: null, standingRank: null };
    const record =
      mine.h2hw !== undefined ? `${mine.h2hw || 0}-${mine.h2hl || 0}${mine.h2ht > 0 ? `-${mine.h2ht}` : ''}` : null;
    return { record, standingRank: idx + 1 };
  } catch (e) {
    return { record: null, standingRank: null };
  }
}

async function buildLive(league, cookie) {
  const [matchup, rank] = await Promise.all([
    liveMatchup(league, cookie).catch(() => ({ week: null, me: null, opponent: null })),
    standing(league, cookie),
  ]);
  return {
    leagueId: league.leagueId,
    host: league.host,
    name: league.name,
    franchiseId: league.franchiseId,
    franchiseName: league.franchiseName,
    week: matchup.week,
    matchup: matchup.me ? { me: matchup.me, opponent: matchup.opponent } : null,
    record: rank.record,
    standingRank: rank.standingRank,
  };
}

function buildDemo(league) {
  const d = demo.dashboard(league.leagueId) || {};
  return {
    leagueId: league.leagueId,
    host: league.host,
    name: league.name,
    franchiseId: league.franchiseId,
    franchiseName: league.franchiseName,
    week: d.week || null,
    matchup: d.matchup || null,
    record: d.record || null,
    standingRank: d.standingRank || null,
  };
}

async function getDashboard(cookie) {
  const leagues = await leaguesService.listLeagues(cookie);

  const cards = await Promise.all(
    leagues.map(async (league) => {
      try {
        return config.demoMode ? buildDemo(league) : await buildLive(league, cookie);
      } catch (e) {
        // Never let one league break the aggregate; surface a degraded card instead.
        return {
          leagueId: league.leagueId,
          host: league.host,
          name: league.name,
          franchiseId: league.franchiseId,
          franchiseName: league.franchiseName,
          error: e.message,
        };
      }
    })
  );

  return { season: config.season, leagues: cards };
}

module.exports = { getDashboard };
