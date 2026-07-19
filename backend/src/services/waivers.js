'use strict';

// Waivers / FAAB / free agents across leagues (M3).
//
// MFL leagues use one of three pickup systems and the claim mechanics differ:
//   faab  -> blind bid: add + drop + $bid, budget-limited, processed at a set time
//   fcfs  -> waiver priority: add + drop, processed in priority order
//   free  -> immediate add/drop (waivers already cleared)
//
// This service exposes a per-league board, a cross-league "best available" view,
// smart assists (suggested drop + bid), and validated preview/submit/cancel.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const scoringLib = require('../lib/scoring');
const availabilityLib = require('../lib/availability');
const enrichmentLib = require('../lib/enrichment');
const nflLib = require('../lib/nfl');
const leagueFormat = require('../lib/leagueformat');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const playersLib = require('../lib/players');
const store = require('../store/waivers');

// Availability context (current week + injury/bye maps). In live these are now
// really fetched from MFL so free agents are badged OUT/bye correctly, instead
// of everyone showing as ACTIVE.
async function ctxFor(cookie) {
  if (config.demoMode) {
    return { week: demo.week(), statusMap: demo.playerStatus(), byeMap: demo.byes() };
  }
  const week = await nflLib.currentWeek(cookie);
  const [statusMap, byeMap] = await Promise.all([nflLib.injuryMap(cookie, week), nflLib.byeMap(cookie, week)]);
  return { week, statusMap, byeMap };
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

// First present, non-empty value among several candidate MFL field names.
function firstNum(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== '') {
      const n = Number(obj[k]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

async function loadSettings(league, cookie) {
  if (config.demoMode) return demo.waiverSettings(league.leagueId) || { system: 'free', rosterSize: 99 };
  // Parse the live league settings (roster size, FAAB budget/priority/system).
  // A hard failure here throws rather than fabricating a board: the old fallback
  // ({system:'free', rosterSize:99}) misrepresented a real FAAB league as
  // unlimited free-agency, which is worse than surfacing the error.
  let res;
  try {
    res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
  } catch (e) {
    console.log(`[waiverSettings] league=${league.leagueId} error=${e.message}`);
    const err = new Error(`Could not load waiver settings for ${league.name || league.leagueId}.`);
    err.status = 502;
    throw err;
  }
  const lg = (res && res.league) || {};
  const franchises = mfl.toArray(lg.franchises && lg.franchises.franchise);
  const mine = franchises.find((f) => String(f.id) === league.franchiseId);
  const faabRemaining = firstNum(mine, 'bbidAvailableBalance');
  const usesFaab = faabRemaining != null || lg.bbidSeasonWaivers === '1' || lg.bbidWaivers === '1';
  const settings = {
    system: usesFaab ? 'faab' : 'fcfs',
    rosterSize: parseInt(lg.rosterSize, 10) || 99,
    faabRemaining,
    // Total season FAAB budget, if MFL exposes it (field name varies by config).
    faabBudget: firstNum(lg, 'bbidTotalBalance', 'bbidBudget', 'faabBudget'),
    minBid: parseInt(lg.minBid, 10) || 1,
    // Waiver order for priority (fcfs) leagues, when present on the franchise.
    waiverPriority: firstNum(mine, 'waiverSortOrder', 'waiverOrder', 'waiver_order'),
    clearTime: null,
  };
  console.log(`[waiverSettings] league=${league.leagueId} system=${settings.system} rosterSize=${settings.rosterSize} faab=${faabRemaining} budget=${settings.faabBudget} priority=${settings.waiverPriority}`);
  return settings;
}

// Enrich a free-agent id into a board entry (value, projection, trend, status).
function makeFreeAgent(id, byId, scoring, statMap, ctx, system, settings, liveProj, enr) {
  const base = playersLib.resolve(byId, id);
  const stat = statMap[id];
  const projection = liveProj && liveProj.has(id)
    ? liveProj.get(id)
    : stat
    ? scoringLib.projectPoints(stat, base.position, scoring)
    : null;
  return {
    id: base.id,
    name: base.name,
    position: base.position,
    team: base.team,
    value: enr.value(id),
    age: enr.age(id),
    projection,
    trend: enr.trend(id),
    ownership: enr.ownership(id),
    onWaivers: system !== 'free',
    clearTime: system !== 'free' ? settings.clearTime || null : null,
    availability: availabilityLib.resolve(base, ctx.statusMap, ctx.byeMap, ctx.week),
  };
}

// Just the free-agent ids for a league (no enrichment). Used by the player hub
// to know, cross-league, where a player is available. Cached via the MFL client.
async function freeAgentIds(cookie, league, limit = 400) {
  if (config.demoMode) return demo.freeAgents(league.leagueId);
  try {
    const res = await mfl.exportRequest('freeAgents', { host: league.host, cookie, L: league.leagueId });
    const units = mfl.toArray(res && res.freeAgents && res.freeAgents.leagueUnit);
    return units.flatMap((u) => mfl.toArray(u && u.player)).map((p) => String(p.id)).slice(0, limit);
  } catch (e) {
    return [];
  }
}

async function loadFreeAgents(cookie, league, settings) {
  const [byId, enr, ctx] = await Promise.all([
    playersLib.load(cookie),
    enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie),
    ctxFor(cookie),
  ]);
  const scoring = config.demoMode ? demo.scoring(league.leagueId) || {} : {};
  const statMap = config.demoMode ? demo.statProjections() : {};

  let ids;
  let liveProj = null;
  if (config.demoMode) {
    ids = demo.freeAgents(league.leagueId);
  } else {
    // export?TYPE=freeAgents returns everyone not on a roster in this league.
    try {
      const res = await mfl.exportRequest('freeAgents', { host: league.host, cookie, L: league.leagueId });
      const units = mfl.toArray(res && res.freeAgents && res.freeAgents.leagueUnit);
      const players = units.flatMap((u) => mfl.toArray(u && u.player));
      ids = players.map((p) => String(p.id)).slice(0, 300); // cap payload
      console.log(`[freeAgents] league=${league.leagueId} total=${players.length} returned=${ids.length}`);
    } catch (e) {
      console.log(`[freeAgents] league=${league.leagueId} error=${e.message}`);
      ids = [];
    }
    // Format-aware projections for the board (MFL projectedScores).
    try {
      const pr = await mfl.exportRequest('projectedScores', { host: league.host, cookie, L: league.leagueId });
      const list = mfl.toArray(pr && pr.projectedScores && pr.projectedScores.playerScore);
      liveProj = new Map(list.map((p) => [String(p.id), Math.round((Number(p.score) || 0) * 10) / 10]));
    } catch (e) {
      /* projections are optional */
    }
  }
  return ids.map((id) => makeFreeAgent(id, byId, scoring, statMap, ctx, settings.system, settings, liveProj, enr));
}

function activeCount(roster) {
  return roster.starters.length + roster.bench.length;
}
function rosterIsFull(roster, settings) {
  return activeCount(roster) >= (settings.rosterSize || 99);
}

// Smart drop: the lowest-value bench player (never a starter or high asset).
function suggestDrop(roster) {
  const bench = roster.bench.slice().sort((a, b) => (a.value || 0) - (b.value || 0) || (a.projection || 0) - (b.projection || 0));
  return bench[0] || null;
}

// Smart FAAB bid: scale remaining budget by the player's dynasty value and a bit
// of waiver-wire heat. Advisory; the user can override.
function suggestBid(settings, add) {
  if (settings.system !== 'faab') return null;
  const remaining = settings.faabRemaining || 0;
  const value = (add.value || 0) / 100;
  const heat = 1 + Math.min(add.trend || 0, 6000) / 20000; // up to ~1.3x
  const bid = Math.round(remaining * value * 0.45 * heat);
  return Math.max(settings.minBid || 1, Math.min(bid, remaining));
}

function claimView(claim, byId) {
  const nm = (id) => (id ? playersLib.resolve(byId, id) : null);
  const add = claim.add && typeof claim.add === 'object' ? claim.add : nm(claim.add);
  const drop = claim.drop && typeof claim.drop === 'object' ? claim.drop : nm(claim.drop);
  return {
    id: claim.id,
    system: claim.system,
    add: add ? { id: add.id, name: add.name, position: add.position } : null,
    drop: drop ? { id: drop.id, name: drop.name, position: drop.position } : null,
    bid: claim.bid != null ? claim.bid : null,
    priority: claim.priority != null ? claim.priority : null,
    status: claim.status || 'pending',
    processTime: claim.processTime || claim.runsAt || null,
  };
}

async function getBoard(cookie, token, leagueId, { position, sort } = {}) {
  const league = await findLeague(cookie, leagueId);
  const settings = await loadSettings(league, cookie);
  const [byId, roster] = await Promise.all([playersLib.load(cookie), rosterService.getRoster(cookie, leagueId)]);

  let freeAgents = await loadFreeAgents(cookie, league, settings);
  // Drop entities whose name didn't resolve (team defenses / non-player ids show
  // up as "Player 0800" and clutter the live board).
  if (!config.demoMode) freeAgents = freeAgents.filter((p) => p.name && !/^Player \d+$/.test(p.name));
  if (position) freeAgents = freeAgents.filter((p) => p.position === position);

  const SORT_KEYS = { projection: 'projection', trend: 'trend', ownership: 'ownership', value: 'value' };
  // Default sort: dynasty value. It's meaningful year-round (waivers/free agents
  // churn all offseason in dynasty), whereas weekly projection is empty between
  // seasons. Now that the enrichment layer supplies values in live too, value is
  // the right default for both modes.
  const key = SORT_KEYS[sort] || 'value';
  freeAgents.sort((a, b) => (b[key] || 0) - (a[key] || 0));

  const pending = store.list(token, leagueId, config.demoMode ? demo.pendingClaims(leagueId) : []).map((c) => claimView(c, byId));
  const results = config.demoMode ? demo.waiverResults(leagueId) : [];

  return {
    leagueId: league.leagueId,
    name: league.name,
    system: settings.system,
    settings: {
      faabBudget: settings.faabBudget || null,
      faabRemaining: settings.faabRemaining != null ? settings.faabRemaining : null,
      minBid: settings.minBid || null,
      waiverPriority: settings.waiverPriority || null,
      waiverTeams: settings.waiverTeams || null,
      rosterSize: settings.rosterSize || null,
      clearTime: settings.clearTime || null,
    },
    rosterFull: rosterIsFull(roster, settings),
    rosterCount: activeCount(roster),
    positions: [...new Set(freeAgents.map((p) => p.position))],
    freeAgents,
    pending,
    results,
  };
}

// Build a validated claim preview (also fills in suggested drop/bid).
async function preview(cookie, token, leagueId, payload) {
  const league = await findLeague(cookie, leagueId);
  const settings = await loadSettings(league, cookie);
  const [byId, roster, enr, faIds] = await Promise.all([
    playersLib.load(cookie),
    rosterService.getRoster(cookie, leagueId),
    enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie),
    freeAgentIds(cookie, league),
  ]);
  // Free-agent set is now validated in live too (from MFL freeAgents), not only
  // in demo — so you can't submit a claim for a player who's on another roster.
  const available = new Set(faIds);
  const rosterIds = new Set([...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi].map((p) => p.id));

  const errors = [];
  const addId = String(payload.addId || '');
  const add = addId ? { ...playersLib.resolve(byId, addId), value: enr.value(addId), age: enr.age(addId), trend: enr.trend(addId) } : null;
  if (!add) errors.push('No player selected to add.');
  else if (rosterIds.has(addId)) errors.push(`${add.name} is already on your roster.`);
  else if (!available.has(addId)) errors.push(`${add.name} is not available in this league.`);

  const full = rosterIsFull(roster, settings);
  const suggestedDrop = suggestDrop(roster);
  let dropId = payload.dropId ? String(payload.dropId) : null;
  if (!dropId && full && suggestedDrop) dropId = suggestedDrop.id; // required when full
  const drop = dropId ? playersLib.resolve(byId, dropId) : null;
  if (dropId && !rosterIds.has(dropId)) errors.push('Chosen drop is not on your roster.');
  if (full && !dropId) errors.push('Your roster is full — a drop is required.');

  // System-specific.
  let bid = null;
  let priority = null;
  let budgetAfter = null;
  const suggestedBid = suggestBid(settings, add || {});
  if (settings.system === 'faab') {
    bid = payload.bid != null ? Math.round(Number(payload.bid)) : suggestedBid;
    const remaining = settings.faabRemaining || 0;
    if (bid == null || Number.isNaN(bid)) errors.push('A bid is required.');
    else if (bid < (settings.minBid || 1)) errors.push(`Bid is below the minimum ($${settings.minBid || 1}).`);
    else if (bid > remaining) errors.push(`Bid exceeds your remaining budget ($${remaining}).`);
    else budgetAfter = remaining - bid;
  } else if (settings.system === 'fcfs') {
    priority = payload.priority != null ? Number(payload.priority) : settings.waiverPriority || null;
  }

  return {
    leagueId: league.leagueId,
    name: league.name,
    system: settings.system,
    immediate: settings.system === 'free',
    add: add ? { id: add.id, name: add.name, position: add.position, team: add.team, value: add.value } : null,
    drop: drop ? { id: drop.id, name: drop.name, position: drop.position, value: enr.value(drop.id) } : null,
    dropRequired: full,
    suggestedDrop: suggestedDrop ? { id: suggestedDrop.id, name: suggestedDrop.name, position: suggestedDrop.position, value: suggestedDrop.value } : null,
    bid,
    suggestedBid,
    priority,
    budgetAfter,
    clearTime: settings.clearTime || null,
    valid: errors.length === 0,
    errors,
  };
}

async function submit(cookie, token, leagueId, payload) {
  const p = await preview(cookie, token, leagueId, payload);
  if (!p.valid) {
    const err = new Error(p.errors.join(' '));
    err.status = 400;
    err.errors = p.errors;
    throw err;
  }
  const league = await findLeague(cookie, leagueId);

  if (!config.demoMode) {
    const type = p.system === 'faab' ? 'blindBidWaiver' : p.system === 'fcfs' ? 'fcfsWaiver' : 'waiverRequest';
    await mfl.importRequest(type, {
      host: league.host,
      cookie,
      L: league.leagueId,
      FRANCHISE: league.franchiseId,
      ADD: p.add.id,
      DROP: p.drop ? p.drop.id : undefined,
      BID: p.bid != null ? p.bid : undefined,
    });
  }

  const claim = store.add(token, leagueId, config.demoMode ? demo.pendingClaims(leagueId) : [], {
    system: p.system,
    add: p.add,
    drop: p.drop,
    bid: p.bid,
    priority: p.priority,
    status: p.immediate ? 'processed' : 'pending',
    processTime: p.immediate ? 'immediate' : p.clearTime,
  });

  return { submitted: claim, board: await getBoard(cookie, token, leagueId, {}) };
}

async function cancel(cookie, token, leagueId, claimId) {
  const removed = store.remove(token, leagueId, config.demoMode ? demo.pendingClaims(leagueId) : [], claimId);
  if (!removed) {
    const err = new Error('Claim not found');
    err.status = 404;
    throw err;
  }
  return { canceled: claimId, board: await getBoard(cookie, token, leagueId, {}) };
}

// Cross-league "best available": top free agents across all your leagues, each
// annotated with which leagues he's available in and under what system.
async function getBestAvailable(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const [byId, enr, ctx] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(undefined, cookie), ctxFor(cookie)]);
  const map = new Map();

  for (const league of leagues) {
    const settings = await loadSettings(league, cookie);
    const scoring = config.demoMode ? demo.scoring(league.leagueId) || {} : {};
    const statMap = config.demoMode ? demo.statProjections() : {};
    for (const id of await freeAgentIds(cookie, league)) {
      const fa = makeFreeAgent(id, byId, scoring, statMap, ctx, settings.system, settings, null, enr);
      if (!map.has(id)) map.set(id, { id: fa.id, name: fa.name, position: fa.position, team: fa.team, value: fa.value, age: fa.age, trend: fa.trend, ownership: fa.ownership, availability: fa.availability, leagues: [] });
      map.get(id).leagues.push({ leagueId: league.leagueId, name: league.name, system: settings.system });
    }
  }

  const players = [...map.values()]
    .map((p) => ({ ...p, leagueCount: p.leagues.length }))
    .sort((a, b) => b.leagueCount - a.leagueCount || (b.value || 0) - (a.value || 0));

  return { totalLeagues: leagues.length, players };
}

// Per-league waiver summary for the landing list (mirrors the Lineups overview):
// one card per league showing system, budget/priority, roster space, how many
// free agents are worth a look, top available by value, and pending claims.
async function getOverview(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const out = [];
  for (const league of leagues) {
    try {
      const settings = await loadSettings(league, cookie);
      const [roster, fas] = await Promise.all([
        rosterService.getRoster(cookie, league.leagueId),
        loadFreeAgents(cookie, league, settings),
      ]);
      let freeAgents = fas;
      if (!config.demoMode) freeAgents = freeAgents.filter((p) => p.name && !/^Player \d+$/.test(p.name));
      freeAgents.sort((a, b) => (b.value || 0) - (a.value || 0));
      const pending = store.list(token, league.leagueId, config.demoMode ? demo.pendingClaims(league.leagueId) : []);
      const pendingCount = pending.filter((c) => (c.status || 'pending') === 'pending').length;
      out.push({
        leagueId: league.leagueId,
        name: league.name,
        system: settings.system,
        faabRemaining: settings.faabRemaining != null ? settings.faabRemaining : null,
        waiverPriority: settings.waiverPriority || null,
        rosterSize: settings.rosterSize || null,
        rosterCount: activeCount(roster),
        rosterFull: rosterIsFull(roster, settings),
        faCount: freeAgents.length,
        pendingCount,
        topAvailable: freeAgents.slice(0, 3).map((p) => ({ id: p.id, name: p.name, position: p.position, value: p.value })),
      });
    } catch (e) {
      out.push({ leagueId: league.leagueId, name: league.name, error: e.message });
    }
  }
  const summary = {
    total: out.length,
    pending: out.reduce((s, l) => s + (l.pendingCount || 0), 0),
    rostersFull: out.filter((l) => l.rosterFull).length,
  };
  return { leagues: out, summary };
}

// League-by-league pickup suggestions for the Waiver Wizard. For each league we
// pre-pick the best add (top free agent by dynasty value), the smart drop (lowest
// bench asset — required when the roster is full), and a suggested FAAB bid, plus
// a shortlist of alternate candidates and the bench for swapping the drop. The
// wizard walks these, letting the owner tweak each before submitting.
async function getSuggestions(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const out = [];
  for (const league of leagues) {
    try {
      const settings = await loadSettings(league, cookie);
      const [roster, fas] = await Promise.all([
        rosterService.getRoster(cookie, league.leagueId),
        loadFreeAgents(cookie, league, settings),
      ]);
      let freeAgents = fas;
      if (!config.demoMode) freeAgents = freeAgents.filter((p) => p.name && !/^Player \d+$/.test(p.name));
      freeAgents.sort((a, b) => (b.value || 0) - (a.value || 0));

      const full = rosterIsFull(roster, settings);
      const drop = suggestDrop(roster);
      const candidates = freeAgents.slice(0, 8).map((p) => ({
        id: p.id, name: p.name, position: p.position, team: p.team,
        value: p.value, projection: p.projection, trend: p.trend, ownership: p.ownership, availability: p.availability,
      }));
      const bench = roster.bench
        .slice()
        .sort((a, b) => (a.value || 0) - (b.value || 0))
        .map((p) => ({ id: p.id, name: p.name, position: p.position, value: p.value }));

      const top = candidates[0] || null;
      let recommended = null;
      if (top) {
        // An "upgrade" means it's worth acting on: either you have an open spot,
        // or the top FA out-values the bench player you'd drop.
        const upgrade = !full || (drop ? (top.value || 0) > (drop.value || 0) : true);
        const useDrop = full ? drop : null; // a drop is only required when full
        const bid = settings.system === 'faab' ? suggestBid(settings, top) : null;
        recommended = {
          add: top,
          drop: useDrop ? { id: useDrop.id, name: useDrop.name, position: useDrop.position, value: useDrop.value } : null,
          bid,
          budgetAfter: bid != null && settings.faabRemaining != null ? settings.faabRemaining - bid : null,
          upgrade,
          reason: !full
            ? 'Open roster spot — top available by value'
            : upgrade
            ? `Upgrade over ${drop ? drop.name.split(',')[0] : 'your bench'}`
            : 'Roster full — top FA doesn’t beat your bench',
        };
      }

      out.push({
        leagueId: league.leagueId,
        name: league.name,
        system: settings.system,
        faabRemaining: settings.faabRemaining != null ? settings.faabRemaining : null,
        minBid: settings.minBid || 1,
        rosterCount: activeCount(roster),
        rosterSize: settings.rosterSize || null,
        rosterFull: full,
        clearTime: settings.clearTime || null,
        recommended,
        candidates,
        bench,
      });
    } catch (e) {
      out.push({ leagueId: league.leagueId, name: league.name, error: e.message });
    }
  }
  const summary = {
    total: out.length,
    withSuggestions: out.filter((l) => l.recommended && l.recommended.upgrade).length,
    withCandidates: out.filter((l) => l.candidates && l.candidates.length).length,
  };
  return { leagues: out, summary };
}

// All pending claims + recent results across leagues, for one activity view.
async function getPending(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const byId = await playersLib.load(cookie);
  const pending = [];
  const results = [];
  for (const league of leagues) {
    for (const c of store.list(token, league.leagueId, config.demoMode ? demo.pendingClaims(league.leagueId) : [])) {
      if ((c.status || 'pending') === 'pending') pending.push({ ...claimView(c, byId), leagueId: league.leagueId, leagueName: league.name });
    }
    for (const r of config.demoMode ? demo.waiverResults(league.leagueId) : []) {
      results.push({ ...r, leagueId: league.leagueId, leagueName: league.name });
    }
  }
  return { pending, results, summary: { pending: pending.length, results: results.length } };
}

module.exports = { getBoard, getOverview, getSuggestions, preview, submit, cancel, getBestAvailable, getPending, freeAgentIds };
