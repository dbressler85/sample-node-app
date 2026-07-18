'use strict';

// Lineup management across all leagues — the heart of M2.
//
// For each league we compute the *current* lineup and the *optimal* lineup (by
// projected points, respecting that league's slot rules), expose the gap, and let
// the user apply the optimal lineup to one league or, in one shot, to all of them.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const optimizer = require('../lib/optimizer');
const scoringLib = require('../lib/scoring');
const rosterService = require('./roster');
const leaguesService = require('./leagues');
const lineupStore = require('../store/lineups');

// --- data loaders (demo vs live) --------------------------------------------

function currentWeek() {
  // Demo has a fixed week; live mode would derive it from liveScoring/nflSchedule.
  return config.demoMode ? demo.week() : Number(process.env.MFL_WEEK) || null;
}

async function loadRequirements(cookie, league) {
  if (config.demoMode) return demo.lineupRequirements(league.leagueId) || [];

  // Live: MFL's `league` export describes starting requirements. Shapes vary by
  // league, so this is a best-effort parse and needs verification against a real
  // account before trusting live mode.
  const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
  const starters = res && res.league && res.league.starters;
  const positions = mfl.toArray(starters && starters.position);
  return positions.map((p) => {
    const eligible = String(p.name || '').split('|').map((s) => s.trim()).filter(Boolean);
    // limit is like "1-1" or "0-3"; use the max as the slot count.
    const max = parseInt(String(p.limit || '1').split('-').pop(), 10) || 1;
    return { name: eligible.length > 1 ? 'FLEX' : eligible[0] || 'FLEX', eligible, count: max };
  });
}

async function loadScoring(cookie, league) {
  if (config.demoMode) return demo.scoring(league.leagueId) || {};
  // Live: MFL's `rules`/`league` exports carry the scoring settings. Parsing them
  // into our scoring shape is a follow-up; live projections below use MFL's own
  // per-league projectedScores instead, which are already format-aware.
  return {};
}

// Format-aware projections: a map of player id -> projected points *for this
// league's scoring*. In demo we compute projected stats x the league's scoring so
// the same player scores differently across formats (PPR, TE premium, 6pt TDs).
// In live mode MFL's projectedScores are already computed in the league's scoring.
async function leagueProjection(cookie, league, poolPlayers, scoring) {
  if (config.demoMode) {
    const stats = demo.statProjections();
    const map = new Map();
    for (const p of poolPlayers) {
      map.set(p.id, scoringLib.projectPoints(stats[p.id], p.position, scoring));
    }
    return map;
  }
  try {
    const res = await mfl.exportRequest('projectedScores', {
      host: league.host,
      cookie,
      L: league.leagueId,
      W: currentWeek(),
    });
    const list = mfl.toArray(res && res.projectedScores && res.projectedScores.playerScore);
    return new Map(list.map((p) => [String(p.id), Number(p.score) || 0]));
  } catch (e) {
    return new Map();
  }
}

function currentStarterIds(token, league, rosterStarterIds) {
  // A previously-applied lineup takes precedence over the roster's default.
  return lineupStore.get(token, league.leagueId) || rosterStarterIds;
}

// --- view building ----------------------------------------------------------

function buildView({ league, week, requirements, pool, starterIds, franchiseName, format }) {
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const optimal = optimizer.optimize(requirements, pool);
  const currentPlayers = starterIds.map((id) => poolById.get(id)).filter(Boolean);
  const current = optimizer.assign(requirements, currentPlayers);
  const currentTotal = optimizer.total(current.assignment);

  const slots = optimal.slots.map((slot, i) => ({
    name: slot.name,
    eligible: slot.eligible,
    current: current.assignment[i] || null,
    optimal: optimal.assignment[i] || null,
  }));

  const currentIds = current.assignment.filter(Boolean).map((p) => p.id);
  const emptySlots = current.assignment.filter((x) => !x).length;
  const delta = optimizer.round1(optimal.total - currentTotal);

  let status;
  if (emptySlots > 0) status = 'incomplete';
  else if (delta > 0.05) status = 'suboptimal';
  else status = 'optimal';

  const startingSet = new Set(currentIds);
  const players = pool
    .map((p) => ({ ...p, starting: startingSet.has(p.id) }))
    .sort((a, b) => b.projection - a.projection);

  return {
    leagueId: league.leagueId,
    name: league.name,
    host: league.host,
    franchiseName: franchiseName || league.franchiseName,
    format,
    week,
    slots,
    players,
    current: { starterIds: currentIds, total: currentTotal },
    optimal: { starterIds: optimal.starterIds, total: optimal.total },
    delta,
    emptySlots,
    status,
  };
}

async function viewForLeague(cookie, token, league) {
  const [requirements, scoring, roster] = await Promise.all([
    loadRequirements(cookie, league),
    loadScoring(cookie, league),
    rosterService.getRoster(cookie, league.leagueId),
  ]);

  const rosterStarterIds = roster.starters.map((p) => p.id);
  const basePool = [...roster.starters, ...roster.bench].map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.team,
  }));

  const projMap = await leagueProjection(cookie, league, basePool, scoring);
  const pool = basePool.map((p) => ({ ...p, projection: projMap.get(p.id) || 0 }));

  const starterIds = currentStarterIds(token, league, rosterStarterIds);
  return buildView({
    league,
    week: currentWeek(),
    requirements,
    pool,
    starterIds,
    franchiseName: roster.franchiseName,
    format: scoringLib.describe(scoring),
  });
}

// --- public API -------------------------------------------------------------

function summarize(view) {
  return {
    leagueId: view.leagueId,
    name: view.name,
    format: view.format,
    week: view.week,
    status: view.status,
    currentTotal: view.current.total,
    optimalTotal: view.optimal.total,
    delta: view.delta,
    emptySlots: view.emptySlots,
    slotCount: view.slots.length,
  };
}

// Cross-league overview — one compact card per league, with the points gap.
async function getOverview(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const views = await Promise.all(
    leagues.map(async (league) => {
      try {
        return summarize(await viewForLeague(cookie, token, league));
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, error: e.message };
      }
    })
  );
  const actionable = views.filter((v) => v.status && v.status !== 'optimal');
  return {
    week: currentWeek(),
    leagues: views,
    summary: {
      total: views.length,
      needAttention: actionable.length,
      pointsAvailable: optimizer.round1(actionable.reduce((s, v) => s + (v.delta || 0), 0)),
    },
  };
}

async function getLineup(cookie, token, leagueId) {
  const leagues = await leaguesService.listLeagues(cookie);
  const league = leagues.find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  return viewForLeague(cookie, token, league);
}

// Submit a lineup to MFL (live) / record it (demo), then return the fresh view.
async function submitLineup(cookie, token, league, starterIds, week) {
  if (!config.demoMode) {
    await mfl.importRequest('lineup', {
      host: league.host,
      cookie,
      L: league.leagueId,
      W: week,
      FRANCHISE: league.franchiseId,
      STARTERS: starterIds.join(','),
    });
  }
  lineupStore.set(token, league.leagueId, starterIds);
}

async function applyLineup(cookie, token, leagueId, starterIds) {
  const leagues = await leaguesService.listLeagues(cookie);
  const league = leagues.find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  const view = await viewForLeague(cookie, token, league);
  const valid = new Set(view.players.map((p) => p.id));
  const ids = (starterIds && starterIds.length ? starterIds : view.optimal.starterIds).map(String);
  const unknown = ids.filter((id) => !valid.has(id));
  if (unknown.length) {
    const err = new Error(`Players not on this roster: ${unknown.join(', ')}`);
    err.status = 400;
    throw err;
  }
  await submitLineup(cookie, token, league, ids, view.week);
  return viewForLeague(cookie, token, league);
}

// The headline: optimize + apply across leagues in one call.
// Body may pass explicit per-league selections; otherwise every non-optimal
// league is set to its optimal lineup.
async function applyAll(cookie, token, selections) {
  const leagues = await leaguesService.listLeagues(cookie);
  const byId = new Map((selections || []).map((s) => [String(s.leagueId), s]));

  const results = await Promise.all(
    leagues.map(async (league) => {
      try {
        const view = await viewForLeague(cookie, token, league);
        const sel = byId.get(league.leagueId);
        const explicit = sel && sel.starters && sel.starters.length;
        // Skip leagues that are already optimal unless the caller named them.
        if (!explicit && view.status === 'optimal') {
          return { leagueId: league.leagueId, name: league.name, applied: false, reason: 'already optimal', before: view.current.total, after: view.current.total, gained: 0 };
        }
        const ids = (explicit ? sel.starters : view.optimal.starterIds).map(String);
        await submitLineup(cookie, token, league, ids, view.week);
        const after = await viewForLeague(cookie, token, league);
        return {
          leagueId: league.leagueId,
          name: league.name,
          applied: true,
          before: view.current.total,
          after: after.current.total,
          gained: optimizer.round1(after.current.total - view.current.total),
          starterIds: ids,
        };
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, applied: false, error: e.message };
      }
    })
  );

  return {
    results,
    summary: {
      leaguesUpdated: results.filter((r) => r.applied).length,
      pointsGained: optimizer.round1(results.reduce((s, r) => s + (r.gained || 0), 0)),
    },
  };
}

module.exports = { getOverview, getLineup, applyLineup, applyAll };
