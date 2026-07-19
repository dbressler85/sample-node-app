'use strict';

// Lineup management across all leagues (M2 + M2.5).
//
// For each league we compute the current and optimal lineups — respecting slot
// rules, that league's SCORING, and player AVAILABILITY (never starting an OUT /
// injured / bye player) — expose the points gap and any warnings, and let the
// user apply one league or all of them. Optimization can favor floor (safe),
// median (balanced), or ceiling (aggressive) points, recommended per matchup.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const optimizer = require('../lib/optimizer');
const scoringLib = require('../lib/scoring');
const availabilityLib = require('../lib/availability');
const rosterService = require('./roster');
const leaguesService = require('./leagues');
const playersLib = require('../lib/players');
const lineupStore = require('../store/lineups');

const MODES = new Set(['auto', 'safe', 'balanced', 'aggressive']);
const WINPROB_SIGMA = 12; // points; controls how projected margin maps to win %

function normalizeMode(mode) {
  return MODES.has(mode) ? mode : 'auto';
}
function modeKeyFor(mode) {
  return mode === 'safe' ? 'floor' : mode === 'aggressive' ? 'ceiling' : 'median';
}
function winProbability(margin) {
  return Math.round((1 / (1 + Math.exp(-margin / WINPROB_SIGMA))) * 100) / 100;
}

// --- data loaders (demo vs live) --------------------------------------------

function currentWeek() {
  return config.demoMode ? demo.week() : Number(process.env.MFL_WEEK) || null;
}

async function loadRequirements(cookie, league) {
  if (config.demoMode) return demo.lineupRequirements(league.leagueId) || [];
  const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
  const starters = res && res.league && res.league.starters;
  const positions = mfl.toArray(starters && starters.position);
  return positions.map((p) => {
    const eligible = String(p.name || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => playersLib.normalizePosition(s));
    const max = parseInt(String(p.limit || '1').split('-').pop(), 10) || 1;
    return { name: eligible.length > 1 ? 'FLEX' : eligible[0] || 'FLEX', eligible, count: max };
  });
}

async function loadScoring(cookie, league) {
  if (config.demoMode) return demo.scoring(league.leagueId) || {};
  return {}; // live scoring-rule parsing is a follow-up; see leagueProjection
}

async function loadStatuses(cookie) {
  if (config.demoMode) return demo.playerStatus();
  try {
    const res = await mfl.exportRequest('injuries', { cookie, W: currentWeek() });
    const list = mfl.toArray(res && res.injuries && res.injuries.injury);
    const map = {};
    for (const i of list) map[String(i.id)] = String(i.status || '').toUpperCase();
    return map;
  } catch (e) {
    return {};
  }
}

// Live byes: MFL's nflSchedule lists the matchups for a week; any NFL team not
// appearing in one is on bye that week. We compare against the full team set
// derived from the loaded player pool (same MFL team codes), so a bye sidelines
// skill players, kickers, and defenses alike.
async function loadByes(cookie) {
  if (config.demoMode) return demo.byes();
  const week = currentWeek();
  if (!week) return {}; // no week context (offseason) -> nothing to compute
  try {
    const res = await mfl.exportRequest('nflSchedule', { cookie, W: week });
    const matchups = mfl.toArray(res && res.nflSchedule && res.nflSchedule.matchup);
    const playing = new Set();
    for (const m of matchups) {
      for (const t of mfl.toArray(m && m.team)) {
        if (t && t.id) playing.add(String(t.id).toUpperCase());
      }
    }
    if (!playing.size) return {}; // schedule not populated yet -> don't guess byes
    const byId = await playersLib.load(cookie);
    const byes = {};
    for (const p of byId.values()) {
      const team = String(p.team || '').toUpperCase();
      if (team && team !== 'FA' && !playing.has(team)) byes[team] = week;
    }
    return byes;
  } catch (e) {
    return {};
  }
}

// Find this week's opponent franchise id from the league schedule.
async function opponentFranchiseId(cookie, league, week) {
  const res = await mfl.exportRequest('schedule', { host: league.host, cookie, L: league.leagueId, W: week });
  const weeks = mfl.toArray(res && res.schedule && res.schedule.weeklySchedule);
  const wk = weeks.find((w) => String(w.week) === String(week)) || weeks[0];
  for (const m of mfl.toArray(wk && wk.matchup)) {
    const ids = mfl.toArray(m && m.franchise).map((f) => String(f.id));
    if (ids.includes(league.franchiseId)) return ids.find((id) => id !== league.franchiseId) || null;
  }
  return null;
}

// The opponent's active (non-IR/taxi) player ids for this league.
async function opponentRosterIds(cookie, league, oppId) {
  const res = await mfl.exportRequest('rosters', { host: league.host, cookie, L: league.leagueId, FRANCHISE: oppId });
  const opp = mfl.toArray(res && res.rosters && res.rosters.franchise).find((f) => String(f.id) === String(oppId));
  if (!opp) return [];
  return mfl.toArray(opp.player)
    .filter((p) => {
      const s = p.status || p.roster_status;
      return s !== 'INJURED_RESERVE' && s !== 'TAXI_SQUAD';
    })
    .map((p) => String(p.id));
}

async function opponentName(cookie, league, oppId) {
  try {
    const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
    const fr = mfl.toArray(res && res.league && res.league.franchises && res.league.franchises.franchise)
      .find((f) => String(f.id) === String(oppId));
    return (fr && fr.name) || `Franchise ${oppId}`;
  } catch (e) {
    return `Franchise ${oppId}`;
  }
}

// Live matchup projection: field the opponent's OPTIMAL lineup under this league's
// slot rules, projecting each of their players with the same league-wide
// projectedScores map we already fetched (it covers every player in the league,
// not just mine) and respecting their injuries/byes. Returns null (no matchup
// shown) on any missing data, so a schedule gap degrades gracefully.
async function resolveMatchupLive({ cookie, league, week, requirements, projMap, statusMap, byeMap }) {
  if (!week || !league.franchiseId || !projMap || projMap.size === 0) return null;
  try {
    const oppId = await opponentFranchiseId(cookie, league, week);
    if (!oppId) return null; // bye week or unscheduled
    const [ids, byId, name] = await Promise.all([
      opponentRosterIds(cookie, league, oppId),
      playersLib.load(cookie),
      opponentName(cookie, league, oppId),
    ]);
    if (!ids.length) return null;
    const pool = ids.map((id) => {
      const base = playersLib.resolve(byId, id);
      const startable = availabilityLib.resolve(base, statusMap, byeMap, week).startable;
      return { id, position: base.position, projection: startable ? projMap.get(id) || 0 : 0 };
    });
    const opt = optimizer.optimize(requirements, pool);
    return { opponent: name, projected: opt.total };
  } catch (e) {
    return null;
  }
}

// Format-aware median projection per player (see M2 commit for rationale).
async function leagueProjection(cookie, league, poolPlayers, scoring) {
  if (config.demoMode) {
    const stats = demo.statProjections();
    const map = new Map();
    for (const p of poolPlayers) map.set(p.id, scoringLib.projectPoints(stats[p.id], p.position, scoring));
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
  return lineupStore.get(token, league.leagueId) || rosterStarterIds;
}

// --- view building ----------------------------------------------------------

function buildView({ league, week, requirements, pool, starterIds, franchiseName, format, matchup, requestedMode }) {
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const startable = pool.filter((p) => p.availability.startable);

  // Assign slots ranking by a chosen band key; report always uses canonical
  // pool objects (projection === median) so the UI shows consistent numbers.
  const assignOn = (players, key) => optimizer.assign(requirements, players.map((p) => ({ ...p, projection: p[key] })));
  const canon = (assignment) => assignment.map((p) => (p ? poolById.get(p.id) : null));
  const sumKey = (players, key) => scoringLib.round1(players.reduce((s, p) => s + (p ? p[key] : 0), 0));

  // Current lineup as fielded (an unavailable starter contributes ~0 points).
  const currentPlayers = starterIds.map((id) => poolById.get(id)).filter(Boolean);
  const current = canon(assignOn(currentPlayers, 'median').assignment);
  const currentMedian = sumKey(current, 'median');

  // Matchup + recommendation are based on the lineup you'd currently field.
  const oppProjected = matchup ? matchup.projected : null;
  const winProb = oppProjected != null ? winProbability(currentMedian - oppProjected) : null;
  const recommendedMode = winProb == null ? 'balanced' : winProb >= 0.6 ? 'safe' : winProb <= 0.4 ? 'aggressive' : 'balanced';
  const effectiveMode = !requestedMode || requestedMode === 'auto' ? recommendedMode : requestedMode;

  const optimalAssign = assignOn(startable, modeKeyFor(effectiveMode));
  const optimal = canon(optimalAssign.assignment);
  const optimalMedian = sumKey(optimal, 'median');

  const slots = optimalAssign.slots.map((slot, i) => ({
    name: slot.name,
    eligible: slot.eligible,
    current: current[i] || null,
    optimal: optimal[i] || null,
  }));

  const currentIds = current.filter(Boolean).map((p) => p.id);
  const optimalIds = optimal.filter(Boolean).map((p) => p.id);
  const currentEmpty = current.filter((x) => !x).length;
  const optimalEmpty = optimal.filter((x) => !x).length;
  const delta = scoringLib.round1(optimalMedian - currentMedian);

  // Warnings: current starters who are unavailable, and slots no healthy player can fill.
  const warnings = [];
  for (const id of starterIds) {
    const p = poolById.get(id);
    if (p && !p.availability.startable) {
      warnings.push({ playerId: p.id, name: p.name, position: p.position, status: p.availability.status });
    }
  }
  if (optimalEmpty > 0) {
    warnings.push({ playerId: null, name: `No healthy player for ${optimalEmpty} slot(s)`, position: null, status: 'INCOMPLETE' });
  }

  // Classify carefully so we don't cry "hole" at an unset lineup:
  //  - nothing set at all (offseason / not submitted) -> 'unset' (just set it),
  //    even if some specialty slot (K/DEF/IDP) can't currently be filled.
  //  - lineup IS set but a slot has no eligible player -> 'incomplete' (waivers).
  const currentSet = current.filter(Boolean).length;
  let status;
  if (warnings.some((w) => w.playerId)) status = 'risk';
  else if (currentSet === 0) status = 'unset';
  else if (optimalEmpty > 0) status = 'incomplete'; // needs a pickup
  else if (currentEmpty > 0) status = 'unset'; // partially set, fillable
  else if (delta > 0.05) status = 'suboptimal';
  else status = 'optimal';

  const startingSet = new Set(currentIds);
  const players = pool
    .map((p) => ({ ...p, starting: startingSet.has(p.id) }))
    .sort((a, b) => b.median - a.median);

  return {
    leagueId: league.leagueId,
    name: league.name,
    host: league.host,
    franchiseId: league.franchiseId,
    franchiseName: franchiseName || league.franchiseName,
    format,
    week,
    mode: effectiveMode,
    recommendedMode,
    matchup: matchup
      ? { opponent: matchup.opponent, opponentProjected: matchup.projected, myProjected: currentMedian, winProb }
      : null,
    slots,
    players,
    current: {
      starterIds: currentIds,
      total: currentMedian,
      floor: sumKey(current, 'floor'),
      ceiling: sumKey(current, 'ceiling'),
    },
    optimal: {
      starterIds: optimalIds,
      total: optimalMedian,
      floor: sumKey(optimal, 'floor'),
      ceiling: sumKey(optimal, 'ceiling'),
    },
    delta,
    emptySlots: currentEmpty,
    warnings,
    status,
  };
}

// `light` skips the per-league projectedScores call (used by the Home rollup,
// which only needs availability + empty-slot detection, not point projections).
async function viewForLeague(cookie, token, league, requestedMode, { light = false } = {}) {
  const [requirements, scoring, roster, statusMap, byeMap] = await Promise.all([
    loadRequirements(cookie, league),
    loadScoring(cookie, league),
    rosterService.getRoster(cookie, league.leagueId),
    loadStatuses(cookie),
    loadByes(cookie),
  ]);
  const week = currentWeek();
  const rosterStarterIds = roster.starters.map((p) => p.id);
  const basePool = [...roster.starters, ...roster.bench].map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.team,
  }));

  const projMap = light ? new Map() : await leagueProjection(cookie, league, basePool, scoring);

  const pool = basePool.map((p) => {
    const median = projMap.get(p.id) || 0;
    const availability = availabilityLib.resolve(p, statusMap, byeMap, week);
    const b = scoringLib.band(median, p.position);
    const startable = availability.startable;
    return {
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.team,
      availability,
      // Unavailable players score ~0 and are never chosen for the optimal lineup.
      floor: startable ? b.floor : 0,
      median: startable ? b.median : 0,
      ceiling: startable ? b.ceiling : 0,
      projection: startable ? b.median : 0,
    };
  });

  // Matchup projection: demo has a fixture; live fields the opponent's optimal
  // lineup from the shared projection map. Skipped in light mode (Home rollup)
  // so it never adds the schedule/opponent-roster calls to the cheap path.
  let matchup = null;
  if (config.demoMode) matchup = demo.matchupProjection(league.leagueId);
  else if (!light) matchup = await resolveMatchupLive({ cookie, league, week, requirements, projMap, statusMap, byeMap });

  return buildView({
    league,
    week,
    requirements,
    pool,
    starterIds: currentStarterIds(token, league, rosterStarterIds),
    franchiseName: roster.franchiseName,
    // Only show a scoring label when we actually parsed the scoring (demo). In
    // live we rely on MFL's already-format-aware projectedScores, so don't
    // fabricate a "Standard · 4pt PaTD" label.
    format: config.demoMode ? scoringLib.describe(scoring) : null,
    matchup,
    requestedMode,
  });
}

// --- public API -------------------------------------------------------------

const STATUS_RANK = { risk: 4, incomplete: 3, unset: 2, suboptimal: 1, optimal: 0 };

function summarize(view) {
  return {
    leagueId: view.leagueId,
    name: view.name,
    format: view.format,
    week: view.week,
    status: view.status,
    mode: view.mode,
    recommendedMode: view.recommendedMode,
    currentTotal: view.current.total,
    optimalTotal: view.optimal.total,
    delta: view.delta,
    emptySlots: view.emptySlots,
    warnings: view.warnings,
    matchup: view.matchup,
    slotCount: view.slots.length,
  };
}

async function getOverview(cookie, token, mode, { light = false } = {}) {
  const requested = normalizeMode(mode);
  const leagues = await leaguesService.listLeagues(cookie);
  const views = await Promise.all(
    leagues.map(async (league) => {
      try {
        return summarize(await viewForLeague(cookie, token, league, requested, { light }));
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, error: e.message };
      }
    })
  );
  // Most urgent first: risk > incomplete > suboptimal > optimal.
  views.sort((a, b) => (STATUS_RANK[b.status] || -1) - (STATUS_RANK[a.status] || -1));

  const actionable = views.filter((v) => v.status && v.status !== 'optimal');
  return {
    week: currentWeek(),
    mode: requested,
    leagues: views,
    summary: {
      total: views.length,
      needAttention: actionable.length,
      risky: views.filter((v) => v.status === 'risk').length,
      unset: views.filter((v) => v.status === 'unset').length,
      // Only "suboptimal" leagues have real points sitting on the bench; an unset
      // lineup's delta is its whole projection, which isn't "left on the table".
      pointsAvailable: scoringLib.round1(
        views.filter((v) => v.status === 'suboptimal').reduce((s, v) => s + (v.delta || 0), 0)
      ),
    },
  };
}

async function findLeague(cookie, leagueId) {
  const leagues = await leaguesService.listLeagues(cookie);
  const league = leagues.find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  return league;
}

async function getLineup(cookie, token, leagueId, mode) {
  const league = await findLeague(cookie, leagueId);
  return viewForLeague(cookie, token, league, normalizeMode(mode));
}

// Lightweight single-league status (used for progressive Home loading).
async function getStatus(cookie, token, leagueId, { light = true } = {}) {
  const league = await findLeague(cookie, leagueId);
  return summarize(await viewForLeague(cookie, token, league, 'auto', { light }));
}

// A preview of "Set All" — per-league diffs (who comes in / out), applied to
// nothing. This is what the review screen renders before the user confirms.
async function plan(cookie, token, mode) {
  const requested = normalizeMode(mode);
  const leagues = await leaguesService.listLeagues(cookie);
  const items = await Promise.all(
    leagues.map(async (league) => {
      try {
        const view = await viewForLeague(cookie, token, league, requested);
        const cur = new Set(view.current.starterIds);
        const opt = new Set(view.optimal.starterIds);
        const byId = new Map(view.players.map((p) => [p.id, p]));
        const drops = view.current.starterIds.filter((id) => !opt.has(id)).map((id) => byId.get(id)).filter(Boolean);
        const adds = view.optimal.starterIds.filter((id) => !cur.has(id)).map((id) => byId.get(id)).filter(Boolean);
        return {
          leagueId: view.leagueId,
          name: view.name,
          format: view.format,
          status: view.status,
          mode: view.mode,
          recommendedMode: view.recommendedMode,
          warnings: view.warnings,
          before: view.current.total,
          after: view.optimal.total,
          gained: view.delta,
          changed: adds.length > 0 || drops.length > 0,
          adds,
          drops,
        };
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, error: e.message };
      }
    })
  );
  items.sort((a, b) => (STATUS_RANK[b.status] || -1) - (STATUS_RANK[a.status] || -1));
  const changed = items.filter((i) => i.changed);
  return {
    mode: requested,
    leagues: items,
    summary: {
      leaguesWithChanges: changed.length,
      pointsAvailable: scoringLib.round1(changed.reduce((s, i) => s + (i.gained || 0), 0)),
    },
  };
}

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

// Reject a manual selection that starts an unavailable player.
function assertStartable(view, ids) {
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const bad = ids.filter((id) => {
    const p = byId.get(id);
    return !p || !p.availability.startable;
  });
  if (bad.length) {
    const names = bad.map((id) => (byId.get(id) ? `${byId.get(id).name} (${byId.get(id).availability.status})` : id));
    const err = new Error(`Can't start unavailable/unknown players: ${names.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

async function applyLineup(cookie, token, leagueId, starterIds, mode) {
  const league = await findLeague(cookie, leagueId);
  const view = await viewForLeague(cookie, token, league, normalizeMode(mode));
  const ids = (starterIds && starterIds.length ? starterIds : view.optimal.starterIds).map(String);
  assertStartable(view, ids);
  await submitLineup(cookie, token, league, ids, view.week);
  return viewForLeague(cookie, token, league, normalizeMode(mode));
}

// Set all lineups at once. `selections` optionally names leagues (and custom
// starters); otherwise every non-optimal league is set to its optimal lineup.
async function applyAll(cookie, token, mode, selections) {
  const requested = normalizeMode(mode);
  const leagues = await leaguesService.listLeagues(cookie);
  const byId = new Map((selections || []).map((s) => [String(s.leagueId), s]));
  const onlyThese = selections && selections.length ? new Set(byId.keys()) : null;

  const results = await Promise.all(
    leagues.map(async (league) => {
      try {
        if (onlyThese && !onlyThese.has(league.leagueId)) return null; // caller narrowed the set
        const view = await viewForLeague(cookie, token, league, requested);
        const sel = byId.get(league.leagueId);
        const explicit = sel && sel.starters && sel.starters.length;
        const ids = (explicit ? sel.starters : view.optimal.starterIds).map(String);
        assertStartable(view, ids);

        const noChange = ids.length === view.current.starterIds.length && ids.every((id) => view.current.starterIds.includes(id));
        if (!explicit && (view.status === 'optimal' || noChange)) {
          return { leagueId: league.leagueId, name: league.name, applied: false, reason: 'already optimal', before: view.current.total, after: view.current.total, gained: 0 };
        }
        await submitLineup(cookie, token, league, ids, view.week);
        const after = await viewForLeague(cookie, token, league, requested);
        return {
          leagueId: league.leagueId,
          name: league.name,
          applied: true,
          before: view.current.total,
          after: after.current.total,
          gained: scoringLib.round1(after.current.total - view.current.total),
          starterIds: ids,
        };
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, applied: false, error: e.message };
      }
    })
  );

  const real = results.filter(Boolean);
  return {
    mode: requested,
    results: real,
    summary: {
      leaguesUpdated: real.filter((r) => r.applied).length,
      pointsGained: scoringLib.round1(real.reduce((s, r) => s + (r.gained || 0), 0)),
    },
  };
}

module.exports = { getOverview, getLineup, getStatus, plan, applyLineup, applyAll };
