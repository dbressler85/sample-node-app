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
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const playersLib = require('../lib/players');
const store = require('../store/waivers');

function ctxFor() {
  return {
    week: config.demoMode ? demo.week() : Number(process.env.MFL_WEEK) || null,
    statusMap: config.demoMode ? demo.playerStatus() : {},
    byeMap: config.demoMode ? demo.byes() : {},
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

async function loadSettings(league, cookie) {
  if (config.demoMode) return demo.waiverSettings(league.leagueId) || { system: 'free', rosterSize: 99 };
  // Parse the live league settings (roster size, FAAB budget/system) best-effort.
  try {
    const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
    const lg = (res && res.league) || {};
    const franchises = mfl.toArray(lg.franchises && lg.franchises.franchise);
    const mine = franchises.find((f) => String(f.id) === league.franchiseId);
    const faabRemaining = mine && mine.bbidAvailableBalance != null && mine.bbidAvailableBalance !== ''
      ? Number(mine.bbidAvailableBalance)
      : null;
    const usesFaab = faabRemaining != null || lg.bbidSeasonWaivers === '1' || lg.bbidWaivers === '1';
    const settings = {
      system: usesFaab ? 'faab' : 'fcfs',
      rosterSize: parseInt(lg.rosterSize, 10) || 99,
      faabRemaining,
      faabBudget: null,
      minBid: parseInt(lg.minBid, 10) || 1,
      clearTime: null,
    };
    console.log(`[waiverSettings] league=${league.leagueId} system=${settings.system} rosterSize=${settings.rosterSize} faab=${faabRemaining}`);
    return settings;
  } catch (e) {
    console.log(`[waiverSettings] league=${league.leagueId} error=${e.message}`);
    return { system: 'free', rosterSize: 99 };
  }
}

// Enrich a free-agent id into a board entry (value, projection, trend, status).
function makeFreeAgent(id, byId, scoring, statMap, ctx, system, settings, liveProj) {
  const base = playersLib.resolve(byId, id);
  const d = config.demoMode ? demo.dynasty(id) : null;
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
    value: d ? d.value : null,
    age: d ? d.age : null,
    projection,
    trend: config.demoMode ? demo.trend(id) : 0,
    ownership: config.demoMode ? demo.ownership(id) : null,
    onWaivers: system !== 'free',
    clearTime: system !== 'free' ? settings.clearTime || null : null,
    availability: availabilityLib.resolve(base, ctx.statusMap, ctx.byeMap, ctx.week),
  };
}

async function loadFreeAgents(cookie, league, settings) {
  const byId = await playersLib.load(cookie);
  const ctx = ctxFor();
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
  return ids.map((id) => makeFreeAgent(id, byId, scoring, statMap, ctx, settings.system, settings, liveProj));
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
    processTime: claim.processTime || null,
  };
}

async function getBoard(cookie, token, leagueId, { position, sort } = {}) {
  const league = await findLeague(cookie, leagueId);
  const settings = await loadSettings(league, cookie);
  const [byId, roster] = await Promise.all([playersLib.load(cookie), rosterService.getRoster(cookie, leagueId)]);

  let freeAgents = await loadFreeAgents(cookie, league, settings);
  if (position) freeAgents = freeAgents.filter((p) => p.position === position);

  const SORT_KEYS = { projection: 'projection', trend: 'trend', ownership: 'ownership', value: 'value' };
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
  const [byId, roster] = await Promise.all([playersLib.load(cookie), rosterService.getRoster(cookie, leagueId)]);
  const available = new Set(config.demoMode ? demo.freeAgents(leagueId) : []);
  const rosterIds = new Set([...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi].map((p) => p.id));

  const errors = [];
  const addId = String(payload.addId || '');
  const add = addId ? { ...playersLib.resolve(byId, addId), ...(config.demoMode ? demo.dynasty(addId) : null), trend: config.demoMode ? demo.trend(addId) : 0 } : null;
  if (!add) errors.push('No player selected to add.');
  else if (rosterIds.has(addId)) errors.push(`${add.name} is already on your roster.`);
  else if (config.demoMode && !available.has(addId)) errors.push(`${add.name} is not available in this league.`);

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
    drop: drop ? { id: drop.id, name: drop.name, position: drop.position, value: (config.demoMode && demo.dynasty(drop.id) || {}).value || null } : null,
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
  const byId = await playersLib.load(cookie);
  const ctx = ctxFor();
  const map = new Map();

  for (const league of leagues) {
    const settings = await loadSettings(league, cookie);
    const scoring = config.demoMode ? demo.scoring(league.leagueId) || {} : {};
    const statMap = config.demoMode ? demo.statProjections() : {};
    for (const id of config.demoMode ? demo.freeAgents(league.leagueId) : []) {
      const fa = makeFreeAgent(id, byId, scoring, statMap, ctx, settings.system, settings);
      if (!map.has(id)) map.set(id, { id: fa.id, name: fa.name, position: fa.position, team: fa.team, value: fa.value, age: fa.age, trend: fa.trend, ownership: fa.ownership, availability: fa.availability, leagues: [] });
      map.get(id).leagues.push({ leagueId: league.leagueId, name: league.name, system: settings.system });
    }
  }

  const players = [...map.values()]
    .map((p) => ({ ...p, leagueCount: p.leagues.length }))
    .sort((a, b) => b.leagueCount - a.leagueCount || (b.value || 0) - (a.value || 0));

  return { totalLeagues: leagues.length, players };
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

module.exports = { getBoard, preview, submit, cancel, getBestAvailable, getPending };
