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
const mflRepo = require('../lib/mflRepo');
const optimizer = require('../lib/optimizer');
const scoringLib = require('../lib/scoring');
const availabilityLib = require('../lib/availability');
const rosterService = require('./roster');
const leaguesService = require('./leagues');
const playersLib = require('../lib/players');
const nflLib = require('../lib/nfl');
const leagueFormat = require('../lib/leagueformat');
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

async function currentWeek(cookie) {
  return config.demoMode ? demo.week() : nflLib.currentWeek(cookie);
}

async function loadRequirements(cookie, league) {
  return leagueFormat.requirements(cookie, league);
}

async function loadScoring(cookie, league) {
  if (config.demoMode) return demo.scoring(league.leagueId) || {};
  return {}; // live scoring-rule parsing is a follow-up; see leagueProjection
}

async function loadStatuses(cookie, week) {
  if (config.demoMode) return demo.playerStatus();
  return nflLib.injuryMap(cookie, week);
}

async function loadByes(cookie, week) {
  if (config.demoMode) return demo.byes();
  return nflLib.byeMap(cookie, week);
}

// Find this week's opponent franchise id from the league schedule.
async function opponentFranchiseId(cookie, league, week) {
  const weeks = await mflRepo.schedule(league, cookie, { W: week });
  const wk = weeks.find((w) => String(w.week) === String(week)) || weeks[0];
  for (const m of mfl.toArray(wk && wk.matchup)) {
    const ids = mfl.toArray(m && m.franchise).map((f) => String(f.id));
    if (ids.includes(league.franchiseId)) return ids.find((id) => id !== league.franchiseId) || null;
  }
  return null;
}

// The opponent's active players, split into the starters they've SET (MFL marks
// the weekly lineup with status "starter") and the full active pool. If they
// haven't set a lineup yet, `starters` comes back empty.
async function opponentRoster(cookie, league, oppId) {
  const opp = (await mflRepo.rosters(league, cookie, { FRANCHISE: oppId })).find((f) => String(f.id) === String(oppId));
  if (!opp) return { all: [], starters: [] };
  const all = [];
  const starters = [];
  for (const p of mfl.toArray(opp.player)) {
    const s = p.status || p.roster_status;
    if (s === 'INJURED_RESERVE' || s === 'TAXI_SQUAD') continue;
    const id = String(p.id);
    all.push(id);
    if (p.status === 'starter') starters.push(id);
  }
  return { all, starters };
}

async function opponentName(cookie, league, oppId) {
  try {
    const fr = (await mflRepo.leagueFranchises(league, cookie)).find((f) => String(f.id) === String(oppId));
    return (fr && fr.name) || `Franchise ${oppId}`;
  } catch (e) {
    return `Franchise ${oppId}`;
  }
}

// Live matchup projection. We can only guess an opponent's output from the
// lineup they'll actually field:
//   * If they've SET their lineup, project exactly those starters (an injured or
//     benched-by-mistake player counts against them — that's real).
//   * If they haven't set it yet, assume their BEST case (optimal lineup), since
//     they still can, and planning against their ceiling is the safe read.
// Either way we use the same league-wide projectedScores map already fetched (it
// covers every player in the league) and respect injuries/byes. Returns null on
// any missing data, so a schedule gap degrades gracefully. `basis` tells the UI
// which read it is: 'submitted' vs 'projected'.
async function resolveMatchupLive({ cookie, league, week, requirements, projMap, statusMap, byeMap }) {
  if (!week || !league.franchiseId || !projMap || projMap.size === 0) return null;
  try {
    const oppId = await opponentFranchiseId(cookie, league, week);
    if (!oppId) return null; // bye week or unscheduled
    const [roster, byId, name] = await Promise.all([
      opponentRoster(cookie, league, oppId),
      playersLib.load(cookie),
      opponentName(cookie, league, oppId),
    ]);
    if (!roster.all.length) return null;

    const scoreOf = (id) => {
      const base = playersLib.resolve(byId, id);
      const startable = availabilityLib.resolve(base, statusMap, byeMap, week).startable;
      return { id, position: base.position, projection: startable ? projMap.get(id) || 0 : 0 };
    };

    const slotCount = requirements.reduce((s, r) => s + (Number(r.count) || 0), 0);
    const hasSetLineup = roster.starters.length >= slotCount && slotCount > 0;

    let projected;
    let basis;
    if (hasSetLineup) {
      // Their submitted starters, as-fielded (unavailable ones score ~0).
      projected = optimizer.round1(roster.starters.reduce((s, id) => s + scoreOf(id).projection, 0));
      basis = 'submitted';
    } else {
      projected = optimizer.optimize(requirements, roster.all.map(scoreOf)).total;
      basis = 'projected';
    }
    return { opponent: name, projected, basis };
  } catch (e) {
    return null;
  }
}

// Format-aware median projection per player (see M2 commit for rationale).
async function leagueProjection(cookie, league, poolPlayers, scoring, week) {
  if (config.demoMode) {
    const stats = demo.statProjections();
    const map = new Map();
    for (const p of poolPlayers) map.set(p.id, scoringLib.projectPoints(stats[p.id], p.position, scoring));
    return map;
  }
  try {
    const list = await mflRepo.projectedScores(league, cookie, { W: week });
    return new Map(list.map((p) => [String(p.id), Number(p.score) || 0]));
  } catch (e) {
    return new Map();
  }
}

// Live: trust a just-applied lineup only briefly, as an optimistic buffer over MFL's
// write→read propagation. Demo: no MFL, so the store is authoritative.
const LINEUP_HINT_TTL_MS = 2 * 60 * 1000;

function currentStarterIds(token, league, week, rosterStarterIds) {
  const hint = lineupStore.get(token, league.leagueId, week);
  if (hint && hint.starterIds.length) {
    if (config.demoMode || Date.now() - hint.at <= LINEUP_HINT_TTL_MS) return hint.starterIds;
  }
  // Otherwise defer to the freshly-read roster — reflects external MFL edits and the week.
  return rosterStarterIds;
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
      ? {
          opponent: matchup.opponent,
          opponentProjected: matchup.projected,
          myProjected: currentMedian,
          winProb,
          // 'submitted' = their set lineup; 'projected' = assumed best (not set yet).
          basis: matchup.basis || 'projected',
        }
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
  const week = await currentWeek(cookie);
  const [requirements, scoring, roster, statusMap, byeMap] = await Promise.all([
    loadRequirements(cookie, league),
    loadScoring(cookie, league),
    rosterService.getRoster(cookie, league.leagueId),
    loadStatuses(cookie, week),
    loadByes(cookie, week),
  ]);
  const rosterStarterIds = roster.starters.map((p) => p.id);
  const basePool = [...roster.starters, ...roster.bench].map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.team,
  }));

  const projMap = light ? new Map() : await leagueProjection(cookie, league, basePool, scoring, week);

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

  // Format label: demo describes its scoring; live now derives it from the
  // parsed scoring rules (superflex + PPR) when detectable — and stays null
  // rather than fabricating a label when the rules can't be parsed. Only the
  // full view needs it, so the light Home rollup skips the extra rules call.
  let format = null;
  if (config.demoMode) {
    format = scoringLib.describe(scoring);
  } else if (!light) {
    const rules = await leagueFormat.scoringRules(cookie, league);
    if (rules.detected) {
      format = leagueFormat.label({ numQbs: leagueFormat.numQbs(requirements), ppr: rules.ppr, tePpr: rules.tePpr });
    }
  }

  return buildView({
    league,
    week,
    requirements,
    pool,
    starterIds: currentStarterIds(token, league, week, rosterStarterIds),
    franchiseName: roster.franchiseName,
    format,
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
    week: await currentWeek(cookie),
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
    try {
      await mfl.importRequest('lineup', {
        host: league.host,
        cookie,
        L: league.leagueId,
        W: week,
        FRANCHISE: league.franchiseId,
        STARTERS: starterIds.join(','),
      });
    } catch (e) {
      // Surface MFL's ACTUAL reason (hard-won rule). A successful save returns "OK" (handled by
      // importRequest), so reaching here is a real rejection — and for an HTML 500 the reason lives
      // on e.body, not e.message, which is exactly what errorDetail digs out. Set err.detail so the
      // Set-All results (and single-apply) can show the real cause per league instead of "(502)".
      const detail = mfl.errorDetail(e);
      console.warn(`[lineups] MFL rejected lineup — L=${league.leagueId} W=${week} starters=${starterIds.length} — ${detail}`);
      const err = new Error(`MyFantasyLeague couldn’t save this lineup: ${detail}`);
      err.status = e.status || 502;
      err.detail = detail;
      throw err;
    }
    // The starter/bench split just changed — drop this league's cached roster so
    // the re-read after applying reflects the new lineup instead of a stale one.
    rosterService.invalidate(cookie, league.leagueId);
  }
  lineupStore.set(token, league.leagueId, week, starterIds);
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
