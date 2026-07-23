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
const mflRepo = require('../lib/mflRepo');
const scoringLib = require('../lib/scoring');
const availabilityLib = require('../lib/availability');
const enrichmentLib = require('../lib/enrichment');
const nflLib = require('../lib/nfl');
const leagueFormat = require('../lib/leagueformat');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const playersLib = require('../lib/players');
const { createMemo } = require('../lib/memo');
const store = require('../store/waivers');
const playerTags = require('../store/playerTags');

// Free-agent reads are heavy (the freeAgents + projectedScores exports, then
// enrichment/availability over up to ~300 players) and re-run across the waivers
// landing, wizard, and best-available views. Memoize per (cookie, league) on the
// short TTL, coalescing concurrent builds; a claim/add/drop invalidates the league.
const faMemo = createMemo({ ttlMs: config.mflCacheTtlMs }); // loadFreeAgents (board entries)
const faIdsMemo = createMemo({ ttlMs: config.mflCacheTtlMs }); // freeAgentIds (bare ids)

// Clear this league's cached free-agent reads (and its roster) after a write.
function invalidate(cookie, leagueId) {
  faMemo.invalidate(`${cookie}|${leagueId}`);
  faIdsMemo.invalidate(`${cookie}|${leagueId}`);
  rosterService.invalidate(cookie, leagueId);
  // A claim here changes rosters/free-agents, so the Players tab's cross-league
  // "mine / free" map is now stale too. Lazy require avoids a playerhub↔waivers cycle.
  require('./playerhub').invalidateGather(cookie);
}

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
    // FAAB balance & waiver priority live in this (otherwise 1h-static) export but
    // change when waivers process overnight — read them near-fresh so a validated bid
    // can't exceed a budget that was already spent.
    res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId, maxAge: config.mflFreshTtlMs });
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
  // Memoize the full id list per (cookie, league) — so invalidation is a single
  // key — and apply the caller's limit after.
  const all = await faIdsMemo.get(`${cookie}|${league.leagueId}`, () => buildFreeAgentIds(cookie, league));
  return all.slice(0, limit);
}
async function buildFreeAgentIds(cookie, league) {
  try {
    const units = await mflRepo.freeAgentUnits(league, cookie);
    return units.flatMap((u) => mfl.toArray(u && u.player)).map((p) => String(p.id));
  } catch (e) {
    return [];
  }
}

async function loadFreeAgents(cookie, league, settings) {
  if (config.demoMode) return buildFreeAgents(cookie, league, settings);
  return faMemo.get(`${cookie}|${league.leagueId}`, () => buildFreeAgents(cookie, league, settings));
}
async function buildFreeAgents(cookie, league, settings) {
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
    // The free-agent list (export?TYPE=freeAgents) and the board's format-aware projections
    // (projectedScores) are independent MFL reads — fetch them in parallel, not in sequence.
    const [faIds, proj] = await Promise.all([
      (async () => {
        try {
          const units = await mflRepo.freeAgentUnits(league, cookie);
          const players = units.flatMap((u) => mfl.toArray(u && u.player));
          const out = players.map((p) => String(p.id)).slice(0, 300); // cap payload
          console.log(`[freeAgents] league=${league.leagueId} total=${players.length} returned=${out.length}`);
          return out;
        } catch (e) {
          console.log(`[freeAgents] league=${league.leagueId} error=${e.message}`);
          return [];
        }
      })(),
      (async () => {
        try {
          const list = await mflRepo.projectedScores(league, cookie);
          return new Map(list.map((p) => [String(p.id), Math.round((Number(p.score) || 0) * 10) / 10]));
        } catch (e) {
          return null; // projections are optional
        }
      })(),
    ]);
    ids = faIds;
    liveProj = proj;
  }
  return ids.map((id) => makeFreeAgent(id, byId, scoring, statMap, ctx, settings.system, settings, liveProj, enr));
}

// Lightweight free-agent summary for the LANDING (count + top 3 by value). The landing
// only shows those, so it doesn't need the full board build — no projectedScores fetch and
// no per-player makeFreeAgent (availability bands, etc.). Just the memoized id list + names
// + dynasty values. The heavy build stays for the board / wizard, which actually use it.
async function freeAgentSummary(cookie, league) {
  const [byId, enr] = await Promise.all([
    playersLib.load(cookie),
    enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie),
  ]);
  const ids = await freeAgentIds(cookie, league);
  const valid = [];
  for (const id of ids) {
    const p = playersLib.resolve(byId, id);
    if (config.demoMode || (p.name && !/^Player \d+$/.test(p.name))) {
      valid.push({ id: p.id, name: p.name, position: p.position, value: enr.value(id) });
    }
  }
  valid.sort((a, b) => (b.value || 0) - (a.value || 0));
  return {
    faCount: valid.length,
    topAvailable: valid.slice(0, 3).map((p) => ({ id: p.id, name: p.name, position: p.position, value: p.value })),
  };
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
  // Personal tags float a Target free agent to the top and sink an Avoid, while the
  // chosen sort still orders within each group.
  for (const p of freeAgents) p.tag = playerTags.get(token, p.id) || null;
  const tagRank = (p) => (p.tag === 'target' ? 0 : p.tag === 'avoid' ? 2 : 1);
  freeAgents.sort((a, b) => tagRank(a) - tagRank(b) || (b[key] || 0) - (a[key] || 0));

  const local = store.list(token, leagueId, config.demoMode ? demo.pendingClaims(leagueId) : []).map((c) => claimView(c, byId));
  // In live, reconcile with MFL's AUTHORITATIVE pending waivers (what's actually queued there —
  // including bids placed outside the app). Merge MFL's claims with any local-store entries whose
  // add isn't already reflected on MFL (dedup by add id, so an app-submitted claim shows once),
  // keeping recently-processed receipts. Best-effort + fail-soft: any read failure falls back to
  // the local store, so the board never breaks on this.
  let pending = local;
  if (!config.demoMode) {
    try {
      const reqs = await mflRepo.pendingWaivers(league, cookie);
      const mflPending = reqs.flatMap((req) =>
        req.picks.map((pick, i) => {
          const add = pick.add ? playersLib.resolve(byId, pick.add) : null;
          const drop = pick.drop ? playersLib.resolve(byId, pick.drop) : null;
          return {
            id: `mfl-${req.system}-${req.round}-${i}`,
            system: req.system,
            add: add ? { id: add.id, name: add.name, position: add.position } : null,
            drop: drop ? { id: drop.id, name: drop.name, position: drop.position } : null,
            bid: pick.bid,
            priority: null,
            round: req.round,
            status: 'pending',
            processTime: null,
            source: 'mfl',
          };
        })
      );
      if (mflPending.length) {
        const mflAdds = new Set(mflPending.map((c) => c.add && c.add.id).filter(Boolean));
        pending = [...mflPending, ...local.filter((c) => !(c.add && mflAdds.has(c.add.id)))];
      }
    } catch (e) {
      /* keep the local-store view */
    }
  }
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

// Shared per-league context for validating one or more claims: settings, my roster,
// values, and the available free-agent set. Loaded once so a multi-claim queue validates
// against a single snapshot.
async function loadClaimCtx(cookie, token, leagueId) {
  const league = await findLeague(cookie, leagueId);
  const settings = await loadSettings(league, cookie);
  const [byId, roster, enr, faIds] = await Promise.all([
    playersLib.load(cookie),
    rosterService.getRoster(cookie, leagueId),
    enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie),
    freeAgentIds(cookie, league),
  ]);
  // Free-agent set is validated in live too (from MFL freeAgents), not only in demo — so
  // you can't submit a claim for a player who's on another roster.
  const available = new Set(faIds);
  const rosterIds = new Set([...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi].map((p) => p.id));
  // Are transactions LOCKED (a waiver claim window) or OPEN (immediate free agency)? Locked when
  // the calendar locks free agency OR the league's draft hasn't completed yet (a startup / mid
  // rookie-draft league — FA isn't open). This mirrors the board's waiverLocks signal so a submit
  // routes the same way the board displays. Demo keeps the old system-based flag (fixtures stay).
  let locked;
  if (config.demoMode) {
    locked = settings.system !== 'free';
  } else {
    const draftService = require('./draft'); // lazy require avoids a waivers↔draft cycle
    const [calLock, faOpen] = await Promise.all([
      calendarLock(cookie, league).catch(() => null),
      draftService.freeAgencyOpen(cookie, token, league).catch(() => true),
    ]);
    locked = !!calLock || !faOpen;
  }
  return { league, settings, byId, roster, enr, available, rosterIds, locked };
}

// Validate ONE claim {addId, dropId?, bid?, priority?} against the shared context. Returns
// the resolved add/drop/bid + per-claim validity. Budget is checked against the FULL
// remaining here; a multi-claim queue also checks the SUM of bids separately.
function validateClaim(payload, ctx) {
  const { settings, byId, roster, enr, available, rosterIds } = ctx;
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
    add: add ? { id: add.id, name: add.name, position: add.position, team: add.team, value: add.value } : null,
    drop: drop ? { id: drop.id, name: drop.name, position: drop.position, value: enr.value(drop.id) } : null,
    dropId,
    dropRequired: full,
    suggestedDrop: suggestedDrop ? { id: suggestedDrop.id, name: suggestedDrop.name, position: suggestedDrop.position, value: suggestedDrop.value } : null,
    bid,
    suggestedBid,
    priority,
    budgetAfter,
    valid: errors.length === 0,
    errors,
  };
}

// Build a validated claim preview (also fills in suggested drop/bid).
async function preview(cookie, token, leagueId, payload) {
  const ctx = await loadClaimCtx(cookie, token, leagueId);
  const c = validateClaim(payload, ctx);
  return {
    leagueId: ctx.league.leagueId,
    name: ctx.league.name,
    system: ctx.settings.system,
    immediate: !ctx.locked, // open window → executes now; locked → queued claim
    locked: ctx.locked,
    clearTime: ctx.settings.clearTime || null,
    ...c,
  };
}

// Validate a QUEUE of claims in one league, with FAAB budgeting across them: each bid can
// fit alone yet the total bust the budget, and N adds on a full roster need N drops. Also
// catches duplicate adds/drops and add-and-drop-the-same-player.
async function previewMulti(cookie, token, leagueId, claims) {
  const ctx = await loadClaimCtx(cookie, token, leagueId);
  const list = (Array.isArray(claims) ? claims : []).filter((c) => c && c.addId);
  const previews = list.map((c) => validateClaim(c, ctx));

  const errors = [];
  const addIds = previews.map((p) => p.add && p.add.id).filter(Boolean);
  const dropIds = previews.map((p) => p.dropId).filter(Boolean);
  if (addIds.some((id, i) => addIds.indexOf(id) !== i)) errors.push('The same player is queued to add more than once.');
  if (dropIds.some((id, i) => dropIds.indexOf(id) !== i)) errors.push('The same player is queued to drop more than once.');
  if (addIds.some((id) => dropIds.includes(id))) errors.push("You can't add and drop the same player.");

  // Roster space if every claim clears: start + adds - unique drops must fit.
  const rosterSize = ctx.settings.rosterSize || 99;
  const uniqueDrops = new Set(dropIds).size;
  const rosterAfter = activeCount(ctx.roster) + addIds.length - uniqueDrops;
  if (rosterAfter > rosterSize) {
    const need = rosterAfter - rosterSize;
    errors.push(`This would put you ${need} over your ${rosterSize} roster spots — queue ${need} more drop${need === 1 ? '' : 's'}.`);
  }

  // FAAB: the SUM of bids can't exceed remaining, even if each fits alone.
  let totalBid = 0;
  let budgetRemaining = null;
  let budgetAfter = null;
  if (ctx.settings.system === 'faab') {
    totalBid = previews.reduce((s, p) => s + (p.bid || 0), 0);
    budgetRemaining = ctx.settings.faabRemaining || 0;
    budgetAfter = budgetRemaining - totalBid;
    if (totalBid > budgetRemaining) errors.push(`Total bids ($${totalBid}) exceed your remaining budget ($${budgetRemaining}).`);
  }

  const valid = previews.length > 0 && previews.every((p) => p.valid) && errors.length === 0;
  return {
    leagueId: ctx.league.leagueId,
    name: ctx.league.name,
    system: ctx.settings.system,
    immediate: !ctx.locked,
    locked: ctx.locked,
    clearTime: ctx.settings.clearTime || null,
    claims: previews,
    summary: { count: previews.length, adds: addIds.length, drops: uniqueDrops, rosterAfter, rosterSize, totalBid, budgetRemaining, budgetAfter, valid, errors },
  };
}

// The current waiver ROUND for a locked league. Read from any pending request (pendingWaivers
// carries it); when nothing is pending yet, default to round 1 — the active/first round. MFL's
// round-based (conditional) blind bidding REQUIRES a ROUND, and omitting it makes MFL's server
// 500 (a generic Internal Server Error, not a clean validation message). Read-only, best-effort.
async function currentWaiverRound(cookie, league) {
  try {
    const pending = await mflRepo.pendingWaivers(league, cookie);
    const withRound = pending.find((p) => p.round != null);
    return withRound ? withRound.round : 1;
  } catch (e) {
    return 1;
  }
}

// Submit ONE claim to MFL with the correct import for the current waiver WINDOW + system.
// (See docs/MFL_API_AUDIT.md §2 — the Import reference.)
//   OPEN window (not locked) -> fcfsWaiver, ADD + optional DROP, executed immediately. This is
//     free agency; the league's faab/fcfs system is irrelevant until a claim window opens.
//   LOCKED + faab -> blindBidWaiverRequest, PICKS="add_bid_drop" ($ bid; 0000 = no drop). ROUND is
//     sent when known (required for conditional bidding; matching the active round is always safe),
//     else omitted (standard bidding uses the current round). One pick/call appends to the round.
//   LOCKED + fcfs -> waiverRequest, ROUND + PICKS="add_drop". Needs the round; without it we
//     surface an honest 501 rather than misfile the claim.
// No-op in demo (callers already guard, but this is double-safe).
async function submitClaimToMfl({ cookie, league, system, addId, dropId, bid, locked, round }) {
  if (config.demoMode) return;
  const add = String(addId);
  const drop = dropId ? String(dropId) : null;
  const base = { host: league.host, cookie, L: league.leagueId };

  try {
    await submitClaimInner({ cookie, league, system, add, drop, bid, locked, round, base });
  } catch (e) {
    // Preserve our OWN precise, intentional errors (locked-FA pre-flight 409, no-round 501).
    if (e.status === 409 || e.status === 501) throw e;
    // An MFL rejection of the real write: log the actual reason (hard-won rule — never let a bare
    // "(500)" be all anyone sees) and surface it to the caller as err.detail so the app shows it.
    const detail = mfl.errorDetail(e);
    console.warn(`[waivers] MFL rejected ${system} claim — L=${league.leagueId} add=${add} drop=${drop || '—'} bid=${bid != null ? bid : '—'} locked=${locked} round=${round != null ? round : '—'} — ${detail}`);
    const err = new Error(`MyFantasyLeague rejected the claim: ${detail}`);
    err.status = e.status || 502;
    err.detail = detail;
    throw err;
  }
}

async function submitClaimInner({ cookie, league, system, add, drop, bid, locked, round, base }) {
  if (!locked) {
    // Open free agency → immediate add/drop, whatever the league's waiver system is.
    // Pre-flight the add against MFL's AUTHORITATIVE status (playerRosterStatus): a free agent
    // whose game has locked, or who was just grabbed by another team, can't be picked up now —
    // fail with a precise reason instead of a cryptic rejected write. Fail-soft: any read/parse
    // failure here does NOT block the add (the write still surfaces MFL's own error). Only the
    // immediate path is gated — a locked-window claim is a bid, not a direct add.
    try {
      const [status] = await mflRepo.playerRosterStatus(league, cookie, add);
      if (status) {
        const elig = mflRepo.addEligibility(status);
        if (!elig.addable) {
          const err = new Error(elig.reason);
          err.status = 409;
          throw err;
        }
      }
    } catch (e) {
      if (e.status === 409) throw e; // our own precise block — surface it
      /* read/parse failure → proceed to the write */
    }
    await mfl.importRequest('fcfsWaiver', { ...base, ADD: add, DROP: drop || undefined });
    return;
  }

  if (system === 'faab') {
    const params = { ...base, PICKS: `${add}_${Math.round(Number(bid) || 0)}_${drop || '0000'}` };
    if (round != null) params.ROUND = round;
    await mfl.importRequest('blindBidWaiverRequest', params);
    return;
  }

  if (round != null) {
    await mfl.importRequest('waiverRequest', { ...base, ROUND: round, PICKS: `${add}_${drop || '0000'}` });
    return;
  }
  const err = new Error(
    'This league’s waivers are locked and the app can’t determine the current waiver round — place this claim in MyFantasyLeague. (Add/drops work here once waivers are open.)'
  );
  err.status = 501;
  throw err;
}

// Submit a whole queue (validated together). Claims fire in order so FAAB priority is
// preserved; each result is reported so a partial failure is visible.
async function submitMulti(cookie, token, leagueId, claims) {
  const pv = await previewMulti(cookie, token, leagueId, claims);
  if (!pv.summary.valid) {
    const msgs = [...pv.summary.errors, ...pv.claims.flatMap((c) => c.errors)];
    const err = new Error(msgs.join(' ') || 'This queue is not valid.');
    err.status = 400;
    err.errors = msgs;
    throw err;
  }
  const league = await findLeague(cookie, leagueId);
  // Source the active round once for the queue (only needed for locked claims).
  const round = !config.demoMode && pv.locked ? await currentWaiverRound(cookie, league) : null;
  const results = [];
  for (const c of pv.claims) {
    try {
      if (!config.demoMode) {
        await submitClaimToMfl({ cookie, league, system: pv.system, addId: c.add.id, dropId: c.drop ? c.drop.id : null, bid: c.bid, locked: pv.locked, round });
      }
      const claim = store.add(token, leagueId, config.demoMode ? demo.pendingClaims(leagueId) : [], {
        system: pv.system,
        add: c.add,
        drop: c.drop,
        bid: c.bid,
        priority: c.priority,
        status: pv.immediate ? 'processed' : 'pending',
        processTime: pv.immediate ? 'immediate' : pv.clearTime,
      });
      results.push({ add: c.add, ok: true, claim });
    } catch (e) {
      results.push({ add: c.add, ok: false, error: mfl.errorDetail(e) });
    }
  }
  if (pv.immediate) invalidate(cookie, leagueId);
  return {
    results,
    summary: { requested: results.length, submitted: results.filter((r) => r.ok).length, totalBid: pv.summary.totalBid, budgetAfter: pv.summary.budgetAfter },
    board: await getBoard(cookie, token, leagueId, {}),
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
    const round = p.locked ? await currentWaiverRound(cookie, league) : null;
    await submitClaimToMfl({ cookie, league, system: p.system, addId: p.add.id, dropId: p.drop ? p.drop.id : null, bid: p.bid, locked: p.locked, round });
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

  // An immediate (free-agency) add/drop changes the roster and FA pool right away;
  // a pending waiver claim doesn't until it processes. Refresh the reads so the
  // board we return — and the next screen — reflect the new state.
  if (p.immediate) invalidate(cookie, leagueId);
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
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const [byId, enr, ctx] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(undefined, cookie), ctxFor(cookie)]);
  const map = new Map();

  // Read every league's settings + free agents in parallel, then merge the (sync)
  // results in order — sequential per-league awaits were the bottleneck here.
  const perLeague = await Promise.all(
    leagues.map(async (league) => {
      // Settings (league export) and free agents (freeAgents export) are independent MFL reads —
      // fetch together so each league costs one throttle round-trip, not two in sequence.
      const [settings, ids] = await Promise.all([loadSettings(league, cookie), freeAgentIds(cookie, league)]);
      const scoring = config.demoMode ? demo.scoring(league.leagueId) || {} : {};
      const statMap = config.demoMode ? demo.statProjections() : {};
      const fas = ids.map((id) => makeFreeAgent(id, byId, scoring, statMap, ctx, settings.system, settings, null, enr));
      return { league, settings, fas };
    })
  );
  for (const { league, settings, fas } of perLeague) {
    for (const fa of fas) {
      if (!map.has(fa.id)) map.set(fa.id, { id: fa.id, name: fa.name, position: fa.position, team: fa.team, value: fa.value, age: fa.age, trend: fa.trend, ownership: fa.ownership, availability: fa.availability, leagues: [] });
      map.get(fa.id).leagues.push({ leagueId: league.leagueId, name: league.name, system: settings.system });
    }
  }

  const players = [...map.values()]
    .map((p) => ({ ...p, leagueCount: p.leagues.length }))
    .sort((a, b) => b.leagueCount - a.leagueCount || (b.value || 0) - (a.value || 0));

  return { totalLeagues: leagues.length, players };
}

// Best plausible timestamp (ms) on an MFL calendar event, tolerant of format:
// epoch seconds (number or "1725000000") or an ISO/parseable date string.
function eventTimeMs(ev) {
  // Unwrap each field through mfl.text so a $t-wrapped calendar value (epoch or date string) is
  // still seen — the old `typeof v === 'string'` filter silently skipped the wrapped form.
  for (const raw of Object.values(ev || {})) {
    const v = mfl.text(raw).trim();
    if (!v) continue;
    if (/^\d{9,10}$/.test(v)) return Number(v) * 1000;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

// The DIRECT signal: MFL's league calendar holds the events that actually control
// transactions — "Lock All Free Agents" / "Allow Add/Drops" / "No Add/Drops". The
// most recent past lock/unlock event tells us if free agency is open right now.
// Best-effort + fully guarded: we scan each event's text for lock/unlock semantics
// (rather than a fixed field name, since the shape varies), so an unfamiliar
// response just yields null and we fall back to the draft heuristic.
async function calendarLock(cookie, league) {
  try {
    const events = await mflRepo.calendar(league, cookie);
    if (!events.length) return null;
    const now = Date.now();
    let latest = null;
    for (const ev of events) {
      // $t-unwrap every field before scanning, else a wrapped title/type wouldn't be seen as text.
      const text = Object.values(ev || {}).map((v) => mfl.text(v)).join(' ').toLowerCase();
      if (!/free agent|add\s*\/?\s*drop|waiver|transaction/.test(text)) continue;
      const unlocks = /unlock|allow|enable|open/.test(text);
      const locks = !unlocks && /lock|no add|freeze|disable|close/.test(text);
      if (!locks && !unlocks) continue;
      const t = eventTimeMs(ev);
      if (t == null || t > now) continue; // only events that have already happened
      if (!latest || t > latest.t) latest = { t, locked: locks };
    }
    return latest && latest.locked ? 'Free agency is locked right now (per the league calendar).' : null;
  } catch (e) {
    return null;
  }
}

// The league CALENDAR also carries the actual PROCESS events — when blind-bid (FAAB) or
// FCFS waivers next clear. These MFL event types mark a run (as opposed to the lock/unlock
// windows calendarLock scans for). We surface the soonest upcoming one so a league whose
// waivers clear within config.waiverImminentMs reads as an act-now item.
const WAIVER_PROCESS_TYPES = new Set(['WAIVER_BBID', 'WAIVER_REVERSE', 'WAIVER_CONT', 'WAIVER']);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Soonest FUTURE waiver-process time (ms) from the calendar, or null. MFL calendar events
// carry `start_time` (epoch seconds) and `happens` — a weekly repeat count ("added at the
// same time each week for the following this many weeks"). We expand each process event into
// its weekly occurrences and return the earliest one still ahead of now. Best-effort + fully
// guarded: any read/parse trouble yields null (the feature simply doesn't highlight).
async function nextWaiverRun(cookie, league) {
  try {
    const events = await mflRepo.calendar(league, cookie);
    const now = Date.now();
    let soonest = null;
    for (const ev of events) {
      if (!WAIVER_PROCESS_TYPES.has(mfl.text(ev.type).toUpperCase())) continue;
      const startSec = mfl.num(ev.start_time);
      if (!Number.isFinite(startSec) || startSec <= 0) continue;
      const start = startSec * 1000;
      const repeats = Math.max(1, Math.min(52, mfl.num(ev.happens) || 1));
      for (let k = 0; k < repeats; k += 1) {
        const t = start + k * WEEK_MS;
        if (t >= now && (soonest == null || t < soonest)) soonest = t;
      }
    }
    return soonest;
  } catch (e) {
    return null;
  }
}

// Waivers/free-agency don't run in every league at every moment. The authoritative
// source is the league CALENDAR (lock/unlock free-agent events); when a league
// doesn't set those, we fall back to inferring from DRAFT state (a scheduled or
// in-progress draft means free agency isn't open yet — the common pre-draft case).
// Returns Map(leagueId -> reason). (Lazy-require draft to avoid a require cycle.)
async function waiverLocks(cookie, token) {
  const map = new Map();
  if (config.demoMode) return map; // demo is a healthy mid-season state
  try {
    const leagues = await leaguesService.listLeagues(cookie);
    const draftService = require('./draft');
    const [draftOv, cal] = await Promise.all([
      draftService.getOverview(cookie, token).catch(() => ({ drafts: [] })),
      Promise.all(leagues.map((l) => calendarLock(cookie, l).then((reason) => [String(l.leagueId), reason]).catch(() => [String(l.leagueId), null]))),
    ]);
    // Calendar first (direct), draft state as the fallback.
    for (const [id, reason] of cal) if (reason) map.set(id, reason);
    for (const d of draftOv.drafts || []) {
      const id = String(d.leagueId);
      if (map.has(id)) continue;
      if (d.status === 'in_progress') map.set(id, 'Draft in progress — free agency is locked until it finishes.');
      else if (d.status === 'scheduled') map.set(id, 'Draft hasn’t happened yet — free agency opens after the draft.');
    }
  } catch (e) {
    /* no lock info -> assume waivers are open */
  }
  return map;
}

// Per-league waiver summary for the landing list (mirrors the Lineups overview):
// one card per league showing system, budget/priority, roster space, how many
// free agents are worth a look, top available by value, and pending claims.
async function getOverview(cookie, token) {
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const [locks, out] = await Promise.all([
    waiverLocks(cookie, token),
    Promise.all(
    leagues.map(async (league) => {
      try {
        // The landing only needs roster SIZE + a free-agent count/top-3, so use the light
        // roster read (no all-franchise valuation / strength) and the light FA summary
        // (no projections / per-player build) instead of the full getRoster + board build.
        // Settings, roster, FA summary, and the next waiver-process time are independent reads —
        // fetch them all together so the league costs one throttle round-trip, not four in sequence.
        const [settings, roster, fa, waiverRun] = await Promise.all([
          loadSettings(league, cookie),
          rosterService.myRosterLight(cookie, league.leagueId),
          freeAgentSummary(cookie, league),
          config.demoMode ? Promise.resolve(null) : nextWaiverRun(cookie, league),
        ]);
        const pending = store.list(token, league.leagueId, config.demoMode ? demo.pendingClaims(league.leagueId) : []);
        const pendingCount = pending.filter((c) => (c.status || 'pending') === 'pending').length;
        // "Imminent" = the next run is ahead of us but within the act-now window. A run already
        // in the past (stale calendar occurrence) doesn't count.
        const waiverImminent = waiverRun != null && waiverRun > Date.now() && waiverRun - Date.now() <= config.waiverImminentMs;
        return {
          leagueId: league.leagueId,
          name: league.name,
          system: settings.system,
          faabRemaining: settings.faabRemaining != null ? settings.faabRemaining : null,
          waiverPriority: settings.waiverPriority || null,
          rosterSize: settings.rosterSize || null,
          rosterCount: activeCount(roster),
          rosterFull: rosterIsFull(roster, settings),
          faCount: fa.faCount,
          pendingCount,
          topAvailable: fa.topAvailable,
          nextWaiverRun: waiverRun,
          waiverImminent,
        };
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, error: e.message };
      }
    })
    ),
  ]);
  for (const l of out) {
    const reason = locks.get(String(l.leagueId));
    if (reason) { l.locked = true; l.lockReason = reason; }
  }
  const summary = {
    total: out.length,
    pending: out.reduce((s, l) => s + (l.pendingCount || 0), 0),
    rostersFull: out.filter((l) => l.rosterFull).length,
    locked: out.filter((l) => l.locked).length,
    // Leagues whose waivers clear within the act-now window — the Home triage count.
    imminent: out.filter((l) => l.waiverImminent).length,
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
  const [locks, out] = await Promise.all([
    waiverLocks(cookie, token),
    Promise.all(
    leagues.map(async (league) => {
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
        // A deeper, position-diverse pool so the wizard can filter by position and
        // pick a different player — not just the single best add.
        const candidates = freeAgents.slice(0, 30).map((p) => ({
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

        return {
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
        };
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, error: e.message };
      }
    })
    ),
  ]);
  for (const l of out) {
    const reason = locks.get(String(l.leagueId));
    if (reason) { l.locked = true; l.lockReason = reason; l.recommended = null; }
  }
  const summary = {
    total: out.length,
    withSuggestions: out.filter((l) => l.recommended && l.recommended.upgrade).length,
    withCandidates: out.filter((l) => l.candidates && l.candidates.length).length,
    locked: out.filter((l) => l.locked).length,
  };
  return { leagues: out, summary };
}

// All pending claims + recent results across leagues, for one activity view. This reads only the
// local claim store (no MFL fan-out), so it's cheap — the one heavy dependency was loading the
// whole player DATABASE to resolve names. App-submitted claims already store add/drop as resolved
// objects, so that map is only needed for the rare claim that stored a bare id; load it lazily
// (and once) instead of always downloading the player universe on the Pending tab.
async function getPending(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const pending = [];
  const results = [];
  let byId = null; // lazily loaded, at most once, only if a claim needs id→name resolution
  const needsResolve = (c) => (c.add && typeof c.add !== 'object') || (c.drop && typeof c.drop !== 'object');
  for (const league of leagues) {
    for (const c of store.list(token, league.leagueId, config.demoMode ? demo.pendingClaims(league.leagueId) : [])) {
      if ((c.status || 'pending') !== 'pending') continue;
      if (needsResolve(c) && byId == null) byId = await playersLib.load(cookie);
      pending.push({ ...claimView(c, byId), leagueId: league.leagueId, leagueName: league.name });
    }
    for (const r of config.demoMode ? demo.waiverResults(league.leagueId) : []) {
      results.push({ ...r, leagueId: league.leagueId, leagueName: league.name });
    }
  }
  return { pending, results, summary: { pending: pending.length, results: results.length } };
}

module.exports = { getBoard, getOverview, getSuggestions, preview, submit, previewMulti, submitMulti, cancel, getBestAvailable, getPending, freeAgentIds, invalidate, nextWaiverRun };
