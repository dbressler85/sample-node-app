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
const { withRetry, withWriteRetry } = require('../lib/retry');
const scoringLib = require('../lib/scoring');
const availabilityLib = require('../lib/availability');
const enrichmentLib = require('../lib/enrichment');
const valueLenses = require('../lib/valueLenses');
const nflLib = require('../lib/nfl');
const leagueFormat = require('../lib/leagueformat');
const pointsMaps = require('../lib/pointsMaps');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const playersLib = require('../lib/players');
const { createMemo } = require('../lib/memo');
const { mapLeagues } = require('../lib/safe');
const store = require('../store/waivers');
const waiverBids = require('../store/waiverBids');
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

// `fresh` (default true) reads the `league` export near-live (60s) for the FAAB balance / priority — the
// bid/claim paths need that so a validated bid can't exceed an already-spent budget. Read-only callers
// that only need the SYSTEM + roster size (e.g. the best-available board) pass fresh:false to serve from
// the 24h `league` cache instead of re-reading all N leagues' settings every 60s.
async function loadSettings(league, cookie, { fresh = true } = {}) {
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
    // Retry a transient throttle before giving up: the overview fans this read out across every
    // league at once (a burst that trips MFL's per-IP limiter), and a single 429/403 here was
    // surfacing as "Could not load waiver settings" for whichever leagues happened to lose the race.
    const params = { host: league.host, cookie, L: league.leagueId };
    if (fresh) params.maxAge = config.mflFreshTtlMs; // near-live only when a caller needs the live FAAB balance
    // More patient than the default (4 attempts, longer backoff ≈ 4s total) so the retry OUTLASTS a
    // transient rate-limit penalty window instead of burning all attempts inside it — that's what left
    // one league perpetually stuck on "could not load waiver settings" while its neighbors loaded.
    res = await withRetry(() => mfl.exportRequest('league', params), 4, 700);
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

  // Waiver SYSTEM from the authoritative `currentWaiverType` (per the league export dictionary:
  // WAIVERS, WAIVERS_FCFS, BBID, BBID_FCFS, FCFS, None). Map BBID* → blind bid (faab), the priority/
  // first-come types → fcfs, and None → free (immediate add/drop, no queued claims). Fall back to the
  // old heuristic (a FAAB balance or a legacy bbid flag ⇒ blind bid) only when the field is absent —
  // so a league that used to be mis-typed as fcfs/faab still resolves, and a `None` league is no
  // longer forced into a phantom waiver system.
  const waiverType = mfl.text(lg.currentWaiverType).toUpperCase();
  let system;
  if (waiverType === 'NONE') system = 'free';
  else if (waiverType === 'BBID' || waiverType === 'BBID_FCFS') system = 'faab';
  else if (waiverType === 'WAIVERS' || waiverType === 'WAIVERS_FCFS' || waiverType === 'FCFS') system = 'fcfs';
  else system = faabRemaining != null || lg.bbidSeasonWaivers === '1' || lg.bbidWaivers === '1' ? 'faab' : 'fcfs';

  // Blind-bid FLOOR is `bbidMinimum` — NOT `minBid`, which the dictionary defines as the AUCTION
  // minimum (a different setting most FAAB leagues don't even have, so we were silently defaulting to
  // $1). Blind bids must also come in `bbidIncrement` steps. A non-FAAB league keeps `minBid` (auction/
  // priority), else 1. `bbidMinimum` may legitimately be 0 (leagues allowing $0 bids), so read it with
  // firstNum and preserve the 0 rather than coalescing it away.
  const bbidMin = firstNum(lg, 'bbidMinimum');
  const minBid = system === 'faab' ? (bbidMin != null ? bbidMin : 1) : parseInt(lg.minBid, 10) || 1;
  const bidIncrement = firstNum(lg, 'bbidIncrement') || 1;

  const settings = {
    system,
    rosterSize: parseInt(lg.rosterSize, 10) || 99,
    faabRemaining,
    // The season FAAB *budget* (starting amount) isn't in this export — only the per-franchise
    // remaining balance (bbidAvailableBalance, read above). The old `bbidTotalBalance/bbidBudget/
    // faabBudget` guesses aren't real league fields (always null in live), so don't pretend.
    faabBudget: null,
    minBid,
    bidIncrement,
    // Waiver order for priority (fcfs) leagues, when present on the franchise.
    waiverPriority: firstNum(mine, 'waiverSortOrder', 'waiverOrder', 'waiver_order'),
    clearTime: null,
  };
  console.log(`[waiverSettings] league=${league.leagueId} type=${waiverType || '—'} system=${settings.system} rosterSize=${settings.rosterSize} faab=${faabRemaining} minBid=${settings.minBid} inc=${settings.bidIncrement} priority=${settings.waiverPriority}`);
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
    // The team's bye WEEK number (regardless of the current week) — availability only flags BYE
    // during the bye itself, but the wizard shows the upcoming bye on every player.
    bye: ctx.byeMap && ctx.byeMap[base.team] != null ? Number(ctx.byeMap[base.team]) : null,
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
    // The transient-throttle retry lives at the source now (mflRepo.freeAgentUnits). It matters here
    // because this list is memoized (faIdsMemo): a swallowed [] would stick for the whole TTL — dropping
    // watchlist "now free" alerts AND making validateClaim reject a VALID add as "not available in this
    // league" (a sticky, misleading block). Retrying at the source re-reads instead of caching empty.
    return freeAgentIdsFromUnits(await mflRepo.freeAgentUnits(league, cookie));
  } catch (e) {
    return [];
  }
}
// Flatten the `freeAgents` export units to a plain id list — used for the backend read AND for a
// device-origin read where the DEVICE fetched the units straight from MFL (docs/DEVICE_ORIGIN_MFL.md).
function freeAgentIdsFromUnits(units) {
  return mfl.toArray(units).flatMap((u) => mfl.toArray(u && u.player)).map((p) => String(p.id));
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
async function freeAgentSummary(cookie, league, deviceFreeAgents = null) {
  const [byId, enr] = await Promise.all([
    playersLib.load(cookie),
    enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie),
  ]);
  // When the device supplied this league's freeAgents units (device-origin overview), flatten those
  // instead of fetching the pool from MFL (docs/DEVICE_ORIGIN_MFL.md).
  const ids = deviceFreeAgents ? freeAgentIdsFromUnits(deviceFreeAgents) : await freeAgentIds(cookie, league);
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

// How many of a position sit on the active roster (starters + bench) — used to protect a lone K/DEF.
function positionCount(roster, pos) {
  return [...roster.starters, ...roster.bench].filter((p) => p.position === pos).length;
}

// Smart drop: the lowest-value bench player — but NEVER suggest cutting your only kicker or only
// defense unless the pickup is itself a kicker/defense (i.e. it replaces that slot). Dropping your
// lone K/DEF leaves you unable to field a legal lineup, so we skip those candidates and take the next
// lowest instead. `addPosition` is the position of the player being added (null when unknown).
function suggestDrop(roster, addPosition) {
  const bench = roster.bench.slice().sort((a, b) => (a.value || 0) - (b.value || 0) || (a.projection || 0) - (b.projection || 0));
  const kCount = positionCount(roster, 'PK');
  const dCount = positionCount(roster, 'DEF');
  const add = addPosition ? String(addPosition).toUpperCase() : null;
  const isProtected = (p) =>
    (p.position === 'PK' && kCount <= 1 && add !== 'PK') ||
    (p.position === 'DEF' && dCount <= 1 && add !== 'DEF');
  const safe = bench.filter((p) => !isProtected(p));
  // Prefer a non-protected drop; only fall back to a protected one if the bench is nothing but the
  // lone K/DEF (a drop is still required when the roster is full).
  return safe[0] || bench[0] || null;
}

// Smart FAAB bid: scale remaining budget by the player's dynasty value and a bit
// of waiver-wire heat. Advisory; the user can override.
function suggestBid(settings, add) {
  if (settings.system !== 'faab') return null;
  const remaining = settings.faabRemaining || 0;
  const value = (add.value || 0) / 100;
  const heat = 1 + Math.min(add.trend || 0, 6000) / 20000; // up to ~1.3x
  let bid = Math.round(remaining * value * 0.45 * heat);
  const floor = Number.isFinite(settings.minBid) ? settings.minBid : 1;
  bid = Math.max(floor, Math.min(bid, remaining));
  // Snap the suggestion up to a legal `bbidIncrement` step so a one-tap accept isn't rejected.
  const inc = settings.bidIncrement || 1;
  if (inc > 1) bid = Math.min(remaining, floor + Math.ceil((bid - floor) / inc) * inc);
  return bid;
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
  // Phase 1: independent base reads in parallel — league settings, the player DB, my roster, and the
  // current week (keys this-year points).
  const [settings, byId, roster, week] = await Promise.all([
    // Read-only board → serve settings from the 24h `league` cache instead of forcing a near-live
    // (60s) re-read on every open. The board only displays FAAB balance / priority; the bid-validating
    // paths (preview/submit via loadClaimCtx) still read fresh:true, so a queued bid can never exceed a
    // spent budget. Without this, opening a single league's board paid a guaranteed `league` network
    // hop every 60s — the "why is one league slow to load?" report.
    loadSettings(league, cookie, { fresh: false }),
    playersLib.load(cookie),
    rosterService.getRoster(cookie, leagueId),
    config.demoMode ? Promise.resolve(demo.week()) : nflLib.currentWeek(cookie).catch(() => null),
  ]);
  // Phase 2: everything that depends on phase 1, ALSO in parallel — free agents, this-league scoring,
  // the pending queue, and recent results are mutually independent MFL exports, so they must not
  // serialize (each serial read paid the request-throttle stagger on every board open/refresh).
  const [rawFreeAgents, points, pending, rawResults] = await Promise.all([
    loadFreeAgents(cookie, league, settings),
    pointsMaps.maps(cookie, league, week),
    reconciledPending(cookie, token, league, byId),
    config.demoMode ? Promise.resolve(demo.waiverResults(leagueId)) : liveWaiverResults(cookie, league, byId),
  ]);

  // Drop entities whose name didn't resolve (team defenses / non-player ids show
  // up as "Player 0800" and clutter the live board).
  let freeAgents = config.demoMode ? rawFreeAgents : rawFreeAgents.filter((p) => p.name && !/^Player \d+$/.test(p.name));
  // Normalize the position filter so a "K" (or "Def"/"DST") request matches the canonical stored
  // position ("PK"/"DEF") — otherwise a kicker filter matched nothing (kickers are stored as PK).
  const posFilter = position ? playersLib.normalizePosition(position) : null;
  if (posFilter) freeAgents = freeAgents.filter((p) => p.position === posFilter);
  // Season-to-date points for each free agent (under this league's scoring), so the board can rank
  // by who's actually producing this year — the sortable "current-year point total" streamers want.
  for (const p of freeAgents) p.seasonPoints = points.season.get(String(p.id)) ?? null;

  const SORT_KEYS = { projection: 'projection', season: 'seasonPoints', trend: 'trend', ownership: 'ownership', value: 'value' };
  // Default sort: dynasty value. It's meaningful year-round (waivers/free agents
  // churn all offseason in dynasty), whereas weekly projection is empty between
  // seasons. Now that the enrichment layer supplies values in live too, value is
  // the right default for both modes.
  const key = SORT_KEYS[sort] || 'value';
  // Personal tags float a Target free agent to the top and sink an Avoid, while the
  // chosen sort still orders within each group.
  for (const p of freeAgents) p.tag = playerTags.get(token, p.id) || null;
  const tagRank = (p) => (p.tag === 'target' ? 0 : p.tag === 'avoid' ? 2 : 1);
  // Break ties on the chosen key by projected points, so equal-value players — and especially the
  // flat-valued streamers (kickers/defenses all share one baseline) — order by who actually scores
  // more this week instead of arbitrarily. A no-op in the offseason (projections are empty), useful
  // in-season for streaming decisions.
  freeAgents.sort(
    (a, b) => tagRank(a) - tagRank(b) || (b[key] || 0) - (a[key] || 0) || (b.projection || 0) - (a.projection || 0)
  );

  // `pending` (reconciled with MFL's authoritative queue) and `rawResults` came from the phase-2
  // parallel batch above — normalize the results here.
  const results = rawResults.map(normResult);

  return {
    leagueId: league.leagueId,
    name: league.name,
    system: settings.system,
    settings: {
      faabBudget: settings.faabBudget || null,
      faabRemaining: settings.faabRemaining != null ? settings.faabRemaining : null,
      minBid: settings.minBid != null ? settings.minBid : null,
      bidIncrement: settings.bidIncrement || null,
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
  const [byId, roster, enr, faIds0] = await Promise.all([
    playersLib.load(cookie),
    rosterService.getRoster(cookie, leagueId),
    enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie),
    freeAgentIds(cookie, league),
  ]);
  // Free-agent set is validated in live too (from MFL freeAgents), not only in demo — so
  // you can't submit a claim for a player who's on another roster.
  // An EMPTY set here is almost never real on the submit path: the wizard/board just offered a
  // valid free agent to claim. It means a throttled `freeAgents` read got cached as [] (faIdsMemo),
  // which would reject EVERY add as "not available in this league" (the exact sticky-empty failure
  // the buildFreeAgentIds comment warns about). Drop that poisoned entry and re-read once, fresh,
  // before trusting it — so a transient throttle can't block a legitimate claim.
  let faIds = faIds0;
  if (!config.demoMode && faIds.length === 0) {
    faIdsMemo.invalidate(`${cookie}|${league.leagueId}`);
    faIds = await freeAgentIds(cookie, league);
  }
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
  // Suggestion respects the lone-K/DEF guard (add position aware); a manual dropId still overrides it,
  // so you can always choose to drop your only kicker/defense yourself.
  const suggestedDrop = suggestDrop(roster, add ? add.position : null);
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
    // `bbidMinimum` can legitimately be 0 (leagues allowing $0 bids), so don't coalesce it to 1.
    const floor = Number.isFinite(settings.minBid) ? settings.minBid : 1;
    const inc = settings.bidIncrement || 1;
    if (bid == null || Number.isNaN(bid)) errors.push('A bid is required.');
    else if (bid < floor) errors.push(`Bid is below the minimum ($${floor}).`);
    else if (bid > remaining) errors.push(`Bid exceeds your remaining budget ($${remaining}).`);
    // Blind bids must land on a `bbidIncrement` step (measured from the minimum); MFL rejects an
    // off-increment bid, so catch it here with a clear message instead of a raw MFL error.
    else if (inc > 1 && (bid - floor) % inc !== 0) errors.push(`Bid must be in $${inc} increments (e.g. $${floor}, $${floor + inc}, $${floor + 2 * inc}).`);
    else budgetAfter = remaining - bid;
  } else if (settings.system === 'fcfs') {
    priority = payload.priority != null ? Number(payload.priority) : settings.waiverPriority || null;
  }

  // Net dynasty value the claim adds to (or removes from) the roster: what you gain minus what you
  // give up. The core dynasty question on any waiver claim — surfaced side-by-side in the UI. Null
  // when there's no add to value; a drop-less add is a straight gain (delta = add value).
  const dropValue = drop ? enr.value(drop.id) : null;
  const valueDelta = add && add.value != null ? Math.round((add.value || 0) - (dropValue || 0)) : null;

  return {
    add: add ? { id: add.id, name: add.name, position: add.position, team: add.team, value: add.value } : null,
    drop: drop ? { id: drop.id, name: drop.name, position: drop.position, value: dropValue } : null,
    valueDelta,
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
  // The same player CAN be queued to drop in more than one claim on purpose — CONTINGENCY claims: bid
  // on several adds that all drop the same guy, knowing only one can win. MFL allows it (the drop only
  // executes once; the other claims can't process against an already-gone player), so we don't block
  // it. We still guard add-and-drop-the-same-player, which is never valid.
  if (addIds.some((id) => dropIds.includes(id))) errors.push("You can't add and drop the same player.");

  // Roster space, accounting for contingency: claims that share a drop are mutually exclusive (the
  // drop can only happen once), so each unique-drop group nets zero on the roster. ONLY claims with
  // no drop actually grow the roster — those are what can push you over.
  const rosterSize = ctx.settings.rosterSize || 99;
  const uniqueDrops = new Set(dropIds).size;
  const droplessAdds = previews.filter((p) => p.add && !p.dropId).length;
  const rosterAfter = activeCount(ctx.roster) + droplessAdds;
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

// Recent WON waiver claims for MY franchise, from MFL's transactions log. A BBID_WAIVER / WAIVER
// transaction is a claim that PROCESSED — the player was actually added — so these are the "won"
// results the Pending tab shows, now WITH the winning FAAB bid (parsed from the row; see below).
// MFL records what HAPPENED, not failed bids: a LOSING blind bid is not written to the transaction
// log at all (only the winner's add is), so "outbid" results can't come from this export — they'd
// require snapshotting our pending bids before a run and diffing after (a stateful follow-up).
// Best-effort + fail-soft: any read/parse trouble yields [] and the section simply stays empty.
async function liveWaiverResults(cookie, league, byId, limit = 8) {
  try {
    // Filter server-side (MFL recommends it — the log "can be a very large set"): the confirmed
    // processed-waiver types + MY franchise, so my recent results aren't crowded out of the window
    // by other teams' claims in a busy league. The client-side franchise check below stays as a net.
    const txns = await mflRepo.transactions(league, cookie, { TRANS_TYPE: 'BBID_WAIVER,WAIVER', FRANCHISE: league.franchiseId, COUNT: 40 });
    const mine = String(league.franchiseId);
    // Resolve an id to a { id, name } ref, or null when it doesn't resolve to a real player.
    const ref = (id) => {
      if (!id) return null;
      const p = playersLib.resolve(byId, id);
      if (!config.demoMode && (!p.name || /^Player \d+$/.test(p.name))) return null;
      return { id: p.id, name: p.name };
    };
    const out = [];
    for (const t of txns) {
      const type = mfl.text(t.type).toUpperCase();
      if (type !== 'BBID_WAIVER' && type !== 'WAIVER') continue;
      if (mfl.text(t.franchise) !== mine) continue;
      // The transaction payload is "added,|dropped," — the same shape league.js parses.
      const parts = mfl.text(t.transaction).split('|');
      const first = (csv) => (csv || '').split(',').map((s) => s.trim()).filter(Boolean)[0];
      const add = ref(first(parts[0]));
      if (!add) continue; // no resolvable player added → not a result we can show
      // CONFIRMED against a live sample: the payload is pipe-delimited with the BID in the MIDDLE for
      // blind-bid rows — "<add>,|<bid>|<drop>," (e.g. "17036,|25.00|15254," = added 17036 for $25,
      // dropped 15254; "16387,|258.00|" = added 16387 for $258, no drop). An FCFS WAIVER row has no
      // bid segment — "<add>,|<drop>,". So the bid is parts[1] on a BBID row (NOT a separate t.bbid
      // field, which doesn't exist), and the drop shifts to parts[2].
      let bid = null;
      let drop = null;
      if (type === 'BBID_WAIVER') {
        bid = mfl.num(parts[1]);
        drop = ref(first(parts[2]));
      } else {
        drop = ref(first(parts[1]));
      }
      // Flat shape (name + separate id): keeps the field `add` a plain string for older app builds,
      // while addId/dropId make both names tappable through to the player card in newer builds.
      out.push({ add: add.name, addId: add.id, drop: drop ? drop.name : null, dropId: drop ? drop.id : null, bid, result: 'won', at: mfl.num(t.timestamp) });
    }
    out.sort((a, b) => (b.at || 0) - (a.at || 0));
    return out.slice(0, limit);
  } catch (e) {
    return [];
  }
}

// Outbid (LOST) blind bids for MY franchise. MFL never writes a losing bid to the transaction log,
// so we snapshot our MFL-queued bids (from pendingWaivers — covers bids placed on the SITE too, not
// just the app) on each view, then detect losses by reconciliation: a bid that's since vanished from
// MFL's pending set was processed by a run; if the player isn't in our recent WINS we were outbid.
// Also purges any resolved app-submitted mirror from the local store so a settled bid stops showing
// as pending. Best-effort + fail-soft. `wins` is the liveWaiverResults rows (won adds).
async function lostBidResults(cookie, token, league, byId, wins) {
  if (config.demoMode) return [];
  try {
    const reqs = await mflRepo.pendingWaivers(league, cookie); // cached; also read by reconciledPending
    const picks = reqs.flatMap((req) =>
      req.picks.map((p) => ({ round: req.round, system: req.system, addId: String(p.add), dropId: p.drop ? String(p.drop) : null, bid: p.bid }))
    );
    const wonAddIds = new Set(wins.map((r) => String(r.addId)).filter(Boolean));
    const { lost, clearedAddIds } = waiverBids.sync(token, league.leagueId, picks, wonAddIds, Date.now());
    // Settled bids shouldn't linger as pending: drop any matching app-submitted mirror from the store.
    if (clearedAddIds.length) {
      const cleared = new Set(clearedAddIds.map(String));
      for (const c of store.list(token, league.leagueId, [])) {
        const addId = c.add && (c.add.id || c.add);
        if (addId && cleared.has(String(addId))) store.remove(token, league.leagueId, [], c.id);
      }
    }
    return lost
      .map((r) => {
        const add = playersLib.resolve(byId, r.addId);
        if (!add.name || /^Player \d+$/.test(add.name)) return null;
        const drop = r.dropId ? playersLib.resolve(byId, r.dropId) : null;
        return { add: add.name, addId: add.id, drop: drop ? drop.name : null, dropId: drop ? drop.id : null, bid: r.bid, result: 'lost', at: Math.floor((r.at || 0) / 1000) };
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Merge the local claim store with MFL's AUTHORITATIVE pending waivers for ONE league — so claims
// queued on MFL (including bids placed on the MFL site, not through the app) actually show up.
// Deduped by add id so an app-submitted claim isn't listed twice. Best-effort + fail-soft: any read
// failure yields just the local view. Returns claimView-shaped rows.
async function reconciledPending(cookie, token, league, byId) {
  const leagueId = league.leagueId;
  const local = store.list(token, leagueId, config.demoMode ? demo.pendingClaims(leagueId) : []).map((c) => claimView(c, byId));
  if (config.demoMode) return local;
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
    if (!mflPending.length) return local;
    const mflAdds = new Set(mflPending.map((c) => c.add && c.add.id).filter(Boolean));
    return [...mflPending, ...local.filter((c) => !(c.add && mflAdds.has(c.add.id)))];
  } catch (e) {
    return local;
  }
}

// Normalize a result to the flat { add, addId, drop, dropId, bid, result, at } shape the app renders.
// `add`/`drop` stay plain-name strings (older builds render them directly); addId/dropId drive the
// tap-through. Handles live rows (already flat with ids) and demo rows (name strings, no ids).
function normResult(r) {
  const name = (v) => (v == null ? null : typeof v === 'object' ? v.name : String(v));
  const idOf = (v, id) => (id != null ? id : v && typeof v === 'object' ? v.id : null);
  return {
    add: name(r.add),
    addId: idOf(r.add, r.addId),
    drop: name(r.drop),
    dropId: idOf(r.drop, r.dropId),
    bid: r.bid != null ? r.bid : null,
    result: r.result || 'won',
    at: r.at != null ? r.at : null,
  };
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
    await withWriteRetry(() => mfl.importRequest('fcfsWaiver', { ...base, ADD: add, DROP: drop || undefined }));
    return;
  }

  if (system === 'faab') {
    const params = { ...base, PICKS: `${add}_${Math.round(Number(bid) || 0)}_${drop || '0000'}` };
    if (round != null) params.ROUND = round;
    await withWriteRetry(() => mfl.importRequest('blindBidWaiverRequest', params));
    return;
  }

  if (round != null) {
    await withWriteRetry(() => mfl.importRequest('waiverRequest', { ...base, ROUND: round, PICKS: `${add}_${drop || '0000'}` }));
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

// Cancel ONE queued pick on MFL by RESUBMITTING its whole round with REPLACE and every OTHER pick
// preserved — MFL has no "delete one claim" call. Per the waiverRequest/blindBidWaiverRequest form:
// PICKS added to a round APPEND unless REPLACE is set (then they replace the round's entries), and
// "to clear the whole round, pass an empty value for PICKS". So we re-read MFL's authoritative queue,
// drop the target pick at `idx` (the index reconciledPending minted the id from), and REPLACE the
// round with the survivors (empty PICKS when it was the last one). Claims placed OUTSIDE the app in
// the same round survive because we rebuild from MFL's own current queue. Surfaces MFL's error detail
// on rejection (never a bare status). Read/rebuild is fail-soft; the write is not (a silent failure
// would leave a "canceled" claim to still process).
async function cancelMflPick({ cookie, league, system, round, idx }) {
  const reqs = await mflRepo.pendingWaivers(league, cookie);
  const req = reqs.find((r) => r.system === system && r.round === round);
  // Nothing queued for this round on MFL anymore (already cleared/processed) → nothing to cancel.
  if (!req) return null;
  const removedPick = req.picks[idx] || null; // the bid we're pulling — returned so the caller can
  const kept = req.picks.filter((_, i) => i !== idx); // record it as CANCELLED (not an outbid loss)
  const asToken = (p) =>
    system === 'faab'
      ? `${p.add}_${Math.round(Number(p.bid) || 0)}_${p.drop || '0000'}`
      : `${p.add}_${p.drop || '0000'}`;
  const PICKS = kept.map(asToken).join(','); // '' clears the whole round
  const command = system === 'faab' ? 'blindBidWaiverRequest' : 'waiverRequest';
  const params = { host: league.host, cookie, L: league.leagueId, ROUND: round, PICKS, REPLACE: 1 };
  try {
    await withWriteRetry(() => mfl.importRequest(command, params)); // REPLACE=1 full-round set → idempotent
  } catch (e) {
    const detail = mfl.errorDetail(e);
    console.warn(`[waivers] MFL rejected cancel — L=${league.leagueId} system=${system} round=${round} idx=${idx} kept=${kept.length} — ${detail}`);
    const err = new Error(`MyFantasyLeague rejected the cancel: ${detail}`);
    err.status = e.status || 502;
    err.detail = detail;
    throw err;
  }
  return removedPick; // { add, drop, bid, ... } — the caller records it as cancelled
}

async function cancel(cookie, token, leagueId, claimId) {
  // Demo: the local store IS the source of truth — no MFL round to resubmit.
  if (config.demoMode) {
    const removed = store.remove(token, leagueId, demo.pendingClaims(leagueId), claimId);
    if (!removed) {
      const err = new Error('Claim not found');
      err.status = 404;
      throw err;
    }
    return { canceled: claimId, board: await getBoard(cookie, token, leagueId, {}) };
  }

  // Live: an MFL-sourced claim (id "mfl-<system>-<round>-<idx>", minted by reconciledPending) lives
  // ONLY in MFL's queue — the old store.remove would 404 on it AND leave the real bid to process.
  // Cancel it on MFL by resubmitting the round without that pick.
  const m = /^mfl-(faab|fcfs)-(\d+)-(\d+)$/.exec(String(claimId));
  if (m) {
    const league = await findLeague(cookie, leagueId);
    const removed = await cancelMflPick({ cookie, league, system: m[1], round: Number(m[2]), idx: Number(m[3]) });
    // Record the cancellation so the next reconcile doesn't see this bid "disappear" from MFL's queue
    // and mislabel a deliberate cancel as an outbid LOSS in recent results.
    if (removed) waiverBids.forget(token, leagueId, { round: Number(m[2]), addId: removed.add });
    // Drop any local mirror of the same claim (app-submitted claims are stored locally too), then
    // refresh the reads so the board we return reflects the now-shorter queue.
    store.remove(token, leagueId, [], claimId);
    invalidate(cookie, leagueId);
    return { canceled: claimId, board: await getBoard(cookie, token, leagueId, {}) };
  }

  // Live but locally-tracked (e.g. an immediate free-agency add mirror that never got an MFL id):
  // remove it from the store as before.
  const removed = store.remove(token, leagueId, [], claimId);
  if (!removed) {
    const err = new Error('Claim not found');
    err.status = 404;
    throw err;
  }
  invalidate(cookie, leagueId);
  return { canceled: claimId, board: await getBoard(cookie, token, leagueId, {}) };
}

// Edit ONE queued pick IN PLACE by RESUBMITTING its whole round with REPLACE — the target pick at
// `idx` swapped for its new bid/drop, every OTHER pick preserved (the same mechanism as cancel/reorder;
// MFL has no "edit one claim" call). Re-reads MFL's authoritative queue so picks placed outside the app
// survive. `bid`/`dropId` are applied only when provided (undefined = keep as-is; dropId '' or null =
// clear the drop). Returns the edited pick; throws 404 if it's no longer queued. Surfaces MFL's detail.
async function editMflPick({ cookie, league, system, round, idx, bid, dropId }) {
  const reqs = await mflRepo.pendingWaivers(league, cookie);
  const req = reqs.find((r) => r.system === system && r.round === round);
  const target = req && req.picks[idx];
  if (!target) {
    const err = new Error('That claim is no longer in your queue — it may have already processed.');
    err.status = 404;
    throw err;
  }
  const picks = req.picks.map((p, i) =>
    i === idx
      ? { ...p, bid: bid != null ? bid : p.bid, drop: dropId !== undefined ? dropId || null : p.drop }
      : p
  );
  const asToken = (p) =>
    system === 'faab'
      ? `${p.add}_${Math.round(Number(p.bid) || 0)}_${p.drop || '0000'}`
      : `${p.add}_${p.drop || '0000'}`;
  const PICKS = picks.map(asToken).join(',');
  const command = system === 'faab' ? 'blindBidWaiverRequest' : 'waiverRequest';
  const params = { host: league.host, cookie, L: league.leagueId, ROUND: round, PICKS, REPLACE: 1 };
  try {
    await withWriteRetry(() => mfl.importRequest(command, params)); // REPLACE=1 full-round set → idempotent
  } catch (e) {
    const detail = mfl.errorDetail(e);
    console.warn(`[waivers] MFL rejected edit — L=${league.leagueId} system=${system} round=${round} idx=${idx} — ${detail}`);
    const err = new Error(`MyFantasyLeague rejected the edit: ${detail}`);
    err.status = e.status || 502;
    err.detail = detail;
    throw err;
  }
  return picks[idx];
}

// Edit a PENDING claim's FAAB bid (and optionally its drop) in place. To change the ADD player or the
// round you still cancel and re-file — only the bid/drop of an existing pick are editable. Live edits an
// MFL-sourced pending claim (id "mfl-<system>-<round>-<idx>") via editMflPick; demo patches the store.
async function edit(cookie, token, leagueId, claimId, { bid, dropId } = {}) {
  // Demo: the local store IS the source of truth — patch the claim in place.
  if (config.demoMode) {
    const patch = {};
    if (bid != null) patch.bid = Math.max(0, Math.round(Number(bid) || 0));
    if (dropId !== undefined) {
      const byId = await playersLib.load(cookie);
      const d = dropId ? playersLib.resolve(byId, dropId) : null;
      patch.drop = d ? { id: d.id, name: d.name, position: d.position } : null;
    }
    const updated = store.update(token, leagueId, demo.pendingClaims(leagueId), claimId, patch);
    if (!updated) {
      const err = new Error('Claim not found');
      err.status = 404;
      throw err;
    }
    return { edited: claimId, board: await getBoard(cookie, token, leagueId, {}) };
  }

  // Live: only an MFL-sourced pending claim can be edited in place.
  const m = /^mfl-(faab|fcfs)-(\d+)-(\d+)$/.exec(String(claimId));
  if (!m) {
    const err = new Error('This claim can’t be edited here — cancel it and file a new one.');
    err.status = 400;
    throw err;
  }
  const system = m[1];
  const round = Number(m[2]);
  const idx = Number(m[3]);
  const league = await findLeague(cookie, leagueId);

  // Validate a FAAB bid against the league's remaining budget (an fcfs claim carries no bid).
  let cleanBid;
  if (bid != null) {
    if (system !== 'faab') {
      const err = new Error('This isn’t a FAAB claim — there’s no bid to change.');
      err.status = 400;
      throw err;
    }
    const settings = await loadSettings(league, cookie);
    cleanBid = Math.max(0, Math.round(Number(bid) || 0));
    const remaining = settings.faabRemaining;
    if (Number.isFinite(remaining) && cleanBid > remaining) {
      const err = new Error(`That bid ($${cleanBid}) is more than your $${remaining} remaining FAAB budget.`);
      err.status = 400;
      throw err;
    }
  }
  if (cleanBid == null && dropId === undefined) {
    const err = new Error('Nothing to change.');
    err.status = 400;
    throw err;
  }

  const editedPick = await editMflPick({ cookie, league, system, round, idx, bid: cleanBid, dropId });
  // Refresh reads so the returned board — and the next screen — reflect the new bid/drop. The outbid
  // snapshot re-syncs from MFL's live queue on the next reconcile (the pick is still present), so unlike
  // cancel there's nothing to forget here.
  invalidate(cookie, leagueId);
  return { edited: claimId, editedPick, board: await getBoard(cookie, token, leagueId, {}) };
}

// Reorder the PICKS within one MFL waiver round to a new priority order by resubmitting the whole
// round with REPLACE (MFL has no "move one pick" call — same mechanism as cancel). Pick order in a
// round is the processing priority for conditional/contingent bids, so this is how you say "try this
// claim before that one". `order` is the desired sequence of pick INDICES into the round's current
// picks; any picks not named are appended in their existing order so nothing is dropped.
async function reorderMflRound({ cookie, league, system, round, order }) {
  const reqs = await mflRepo.pendingWaivers(league, cookie);
  const req = reqs.find((r) => r.system === system && r.round === round);
  if (!req) return;
  const named = order.filter((i) => Number.isInteger(i) && i >= 0 && i < req.picks.length);
  const seen = new Set(named);
  const seq = [...named, ...req.picks.map((_, i) => i).filter((i) => !seen.has(i))];
  // No actual change → skip the write (avoid a pointless MFL round-trip / rejection risk).
  if (seq.every((i, k) => i === k)) return;
  const picks = seq.map((i) => req.picks[i]);
  const asToken = (p) =>
    system === 'faab'
      ? `${p.add}_${Math.round(Number(p.bid) || 0)}_${p.drop || '0000'}`
      : `${p.add}_${p.drop || '0000'}`;
  const PICKS = picks.map(asToken).join(',');
  const command = system === 'faab' ? 'blindBidWaiverRequest' : 'waiverRequest';
  const params = { host: league.host, cookie, L: league.leagueId, ROUND: round, PICKS, REPLACE: 1 };
  try {
    await withWriteRetry(() => mfl.importRequest(command, params)); // REPLACE=1 full-round set → idempotent
  } catch (e) {
    const detail = mfl.errorDetail(e);
    console.warn(`[waivers] MFL rejected reorder — L=${league.leagueId} system=${system} round=${round} — ${detail}`);
    const err = new Error(`MyFantasyLeague rejected the reorder: ${detail}`);
    err.status = e.status || 502;
    err.detail = detail;
    throw err;
  }
}

// Reorder a league's pending claims to `orderedIds` (the desired top-to-bottom sequence of claim ids
// as shown in the app). Demo reorders the local store; live groups the MFL-sourced ids by round and
// resubmits each round in the requested relative order (cross-round moves aren't a thing on MFL).
async function reorder(cookie, token, leagueId, orderedIds) {
  const ids = Array.isArray(orderedIds) ? orderedIds : [];
  if (config.demoMode) {
    store.reorder(token, leagueId, demo.pendingClaims(leagueId), ids);
    return { reordered: true, board: await getBoard(cookie, token, leagueId, {}) };
  }
  const league = await findLeague(cookie, leagueId);
  // Group the requested order by (system, round), preserving the requested relative order of picks.
  const groups = new Map();
  for (const id of ids) {
    const m = /^mfl-(faab|fcfs)-(\d+)-(\d+)$/.exec(String(id));
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    if (!groups.has(key)) groups.set(key, { system: m[1], round: Number(m[2]), order: [] });
    groups.get(key).order.push(Number(m[3]));
  }
  for (const g of groups.values()) {
    await reorderMflRound({ cookie, league, system: g.system, round: g.round, order: g.order });
  }
  // Mirror the order locally too (app-submitted claims are stored), then refresh reads.
  store.reorder(token, leagueId, [], ids);
  invalidate(cookie, leagueId);
  return { reordered: true, board: await getBoard(cookie, token, leagueId, {}) };
}

// Cross-league "best available": top free agents across all your leagues, each
// annotated with which leagues he's available in and under what system.
// `deviceReads` (optional) maps leagueId -> the raw `freeAgents` export units the DEVICE fetched
// straight from MFL — when present, the heavy free-agent-pool fan-out (the biggest read here, up to
// thousands of players per league) leaves the shared IP (docs/DEVICE_ORIGIN_MFL.md); settings, the
// open/closed check, enrichment, and the cross-league merge all stay on the backend.
// `format` (optional) re-prices the cross-league board through a single value lens ('1qb' | 'sf')
// so the Free Agents tab can match the Players screen's SF↔1QB toggle. Null uses the neutral market
// (docs/DATA_SOURCES.md Q3).
async function getBestAvailable(cookie, token, { deviceReads = null, format = null, tep = false } = {}) {
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  // `enr` is the single default-lens snapshot for the row's baseline `value`; `lensSnaps` carries all
  // four lenses so the board re-prices on the client's 1QB/2QB/TE-prem toggle with no refetch.
  const [byId, enr, ctx, lensSnaps] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(leagueFormat.lensFormat(format, tep), cookie), ctxFor(cookie), valueLenses.buildLensSnaps(cookie)]);
  // Season-to-date points + this week's projection, under the owner's primary league's scoring — the
  // key streaming signal for free agents (who to grab this week), on every row.
  const points = await pointsMaps.maps(cookie, leagues[0] || null, ctx.week);
  const map = new Map();

  // Read every league's settings + free agents in parallel, then merge the (sync)
  // results in order — sequential per-league awaits were the bottleneck here.
  const draftService = require('./draft'); // lazy require — avoids a waivers↔draft load cycle
  const perLeague = await Promise.all(
    leagues.map(async (league) => {
      // A league whose draft hasn't been HELD yet (startup / scheduled or mid rookie draft) has no
      // true free agents — its entire pool reads as unrostered. Exclude it so pre-draft leagues don't
      // flood the Free Agents tab with every undrafted player.
      const open = await draftService.freeAgencyOpen(cookie, token, league).catch(() => true);
      if (!open) return { league, settings: null, fas: [] };
      // Settings (league export) and free agents (freeAgents export) are independent MFL reads —
      // fetch together so each league costs one throttle round-trip, not two in sequence. When the
      // device supplied this league's free-agent units, use them instead of the backend fetch.
      const dr = deviceReads ? deviceReads[String(league.leagueId)] : null;
      const [settings, ids] = await Promise.all([
        loadSettings(league, cookie, { fresh: false }), // read-only board — the 24h league cache is fine (no live FAAB needed)
        dr ? Promise.resolve(freeAgentIdsFromUnits(dr)) : freeAgentIds(cookie, league),
      ]);
      const scoring = config.demoMode ? demo.scoring(league.leagueId) || {} : {};
      const statMap = config.demoMode ? demo.statProjections() : {};
      const fas = ids.map((id) => makeFreeAgent(id, byId, scoring, statMap, ctx, settings.system, settings, null, enr));
      return { league, settings, fas };
    })
  );
  for (const { league, settings, fas } of perLeague) {
    for (const fa of fas) {
      if (!map.has(fa.id)) map.set(fa.id, { id: fa.id, name: fa.name, position: fa.position, team: fa.team, value: fa.value, age: fa.age, trend: fa.trend, ownership: fa.ownership, availability: fa.availability, seasonPoints: points.season.get(String(fa.id)) ?? null, weekProjection: points.proj.get(String(fa.id)) ?? null, leagues: [] });
      map.get(fa.id).leagues.push({ leagueId: league.leagueId, name: league.name, system: settings.system });
    }
  }

  const players = [...map.values()]
    .map((p) => ({ ...p, leagueCount: p.leagues.length }))
    .sort((a, b) => b.leagueCount - a.leagueCount || (b.value || 0) - (a.value || 0));
  valueLenses.attachLensValues(players, lensSnaps);

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
    // The transient-throttle retry lives at the source now (mflRepo.calendar); it matters here because
    // swallowing a throttle to null drops the "waiver window open — get a claim in" item from On Deck and
    // Home, a genuinely actionable last-chance alert.
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
      mapLeagues(leagues, (l) => calendarLock(cookie, l).then((reason) => [String(l.leagueId), reason]), (l) => [String(l.leagueId), null], 'waivers.calendarLock'),
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
// A league's waiver POSTURE from the calendar + draft state, shared by the waiver landing AND the
// wizard so both agree on whether you can act now:
//   'fa_open'      — free agency is open: add anyone immediately.
//   'waivers_soon' — a run is scheduled ahead (calendar nextWaiverRun): QUEUE claims now, they process
//                    then. A FAAB league between runs lands here — you can and should still queue.
//   'locked'       — neither: no open FA and no upcoming run (draft pending / offseason quiet).
// Returns { waiverState, lockReason }. `waiverRun` is the soonest upcoming run (ms) or null.
async function waiverPosture(cookie, token, league, settings, waiverRun) {
  if (config.demoMode) {
    return { waiverState: settings.system === 'free' ? 'fa_open' : 'waivers_soon', lockReason: null };
  }
  const draftService = require('./draft'); // lazy require — avoids a waivers↔draft cycle
  // Bias toward LOCKED when a read is uncertain: if the "is free agency open?" check fails/loads,
  // default it to CLOSED (not open). Wrongly showing "waivers run soon" for a league that's actually
  // open is harmless (you'll still see the board); wrongly flashing "FA OPEN — add anyone now" for a
  // league that's really locked invites a claim that can't process. So err on the side of locked.
  const [calLock, open] = await Promise.all([
    calendarLock(cookie, league).catch(() => null),
    draftService.freeAgencyOpen(cookie, token, league).catch(() => false),
  ]);
  const faOpen = !calLock && open;
  const hasUpcomingRun = waiverRun != null && waiverRun > Date.now();
  const waiverState = faOpen ? 'fa_open' : hasUpcomingRun ? 'waivers_soon' : 'locked';
  return { waiverState, lockReason: waiverState === 'locked' ? calLock : null };
}

// `deviceReads` (optional) maps leagueId -> the raw `freeAgents` units the DEVICE fetched — when present,
// the per-league free-agent-pool read (the heaviest here) is served from it (docs/DEVICE_ORIGIN_MFL.md).
// The light reads (settings/roster/calendar/pending) stay on the backend.
async function getOverview(cookie, token, { deviceReads = null } = {}) {
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const byId = await playersLib.load(cookie); // cached; used to resolve reconciled pending names
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
        const dr = deviceReads ? deviceReads[String(league.leagueId)] : null;
        const [settings, roster, fa, waiverRun, pending] = await Promise.all([
          // fresh:false — the landing is READ-ONLY (it only displays FAAB balance / priority / system /
          // roster size), so serve settings from the 24h `league` cache like getBoard does. The overview
          // fans this read across EVERY league at once; with fresh:true each league forced a near-live
          // (60s) `league` hop on every load, and that simultaneous burst tripped MFL's per-IP limiter —
          // surfacing as "Could not load waiver settings" for whichever leagues lost the race. The
          // bid-validating paths (preview/submit via loadClaimCtx) still read fresh:true, so a queued bid
          // can never exceed a spent budget.
          loadSettings(league, cookie, { fresh: false }),
          rosterService.myRosterLight(cookie, league.leagueId),
          freeAgentSummary(cookie, league, dr),
          config.demoMode ? Promise.resolve(null) : nextWaiverRun(cookie, league),
          // Reconcile with MFL's queue so the count reflects claims placed on the site too, not just
          // in-app ones (byId is cached from the reads above).
          reconciledPending(cookie, token, league, byId),
        ]);
        const pendingCount = pending.filter((c) => (c.status || 'pending') === 'pending').length;
        // "Imminent" = the next run is ahead of us but within the act-now window. A run already
        // in the past (stale calendar occurrence) doesn't count.
        const waiverImminent = waiverRun != null && waiverRun > Date.now() && waiverRun - Date.now() <= config.waiverImminentMs;
        // The league's pickup posture (calendar + draft aware), so the UI can be explicit.
        const { waiverState } = await waiverPosture(cookie, token, league, settings, waiverRun);
        return {
          leagueId: league.leagueId,
          name: league.name,
          system: settings.system,
          waiverState,
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
// One league's wizard suggestion: best add + smart drop + FAAB bid + a position-diverse shortlist.
// Extracted so the wizard can load it PER LEAGUE (progressive) instead of blocking on all N at once.
// `resolveLockReason` yields the "why it's locked" string — the batch path passes the pre-computed
// cross-league lock map; the standalone (per-league) path resolves it on its own via calendarLock.
async function leagueSuggestionOne(cookie, token, league, { seedAddId = null } = {}) {
      try {
        const draftService = require('./draft'); // lazy require — avoids a waivers↔draft cycle
        // Phase 1: independent base reads in PARALLEL — league settings, format (SF/PPR/TEP, also keys
        // the value snapshot), the player DB, and the week/injury/bye context.
        const [settings, fmt, byId, ctx] = await Promise.all([
          // fresh:false — a wizard SUGGESTION is read-only; it only needs the system + roster size + FAAB
          // balance for display, so serve settings from the 24h `league` cache. getSuggestions fans this
          // across EVERY league at once (Promise.all over leagues), so fresh:true forced a simultaneous
          // near-live burst that tripped MFL's per-IP limiter — the same "Could not load waiver settings"
          // failure just fixed in getOverview. The bid-validating submit path (loadClaimCtx) reads
          // fresh:true on its own, so a queued bid still can't exceed a spent budget.
          loadSettings(league, cookie, { fresh: false }),
          leagueFormat.format(cookie, league),
          playersLib.load(cookie),
          ctxFor(cookie),
        ]);
        // Phase 2: everything that depends on phase 1, ALSO in parallel — roster, free agents, values,
        // this-week/this-year points, the pending queue, and the calendar/draft posture signals. This
        // is the wizard's first-paint HOT PATH, so nothing here runs sequentially (the enrichment used
        // to chain settings→format→batch→pending→posture→lockReason, which made a single league slow).
        const [roster, fas, waiverRun, enr, points, pend, calLock, faOpen, draftReason] = await Promise.all([
          rosterService.getRoster(cookie, league.leagueId),
          loadFreeAgents(cookie, league, settings),
          config.demoMode ? Promise.resolve(null) : nextWaiverRun(cookie, league).catch(() => null),
          enrichmentLib.snapshot(fmt, cookie),
          pointsMaps.maps(cookie, league, ctx.week), // reuse ctx.week (no second currentWeek fetch)
          reconciledPending(cookie, token, league, byId).catch(() => []),
          config.demoMode ? Promise.resolve(null) : calendarLock(cookie, league).catch(() => null),
          config.demoMode ? Promise.resolve(true) : draftService.freeAgencyOpen(cookie, token, league).catch(() => false),
          // The draft-attributable lock reason (parallel with faOpen, sharing its cached draft reads) so a
          // draft-pending league's lock still explains itself ("Draft hasn't happened yet…"). Without this
          // the calendar-only reason lost the DRAFT case, leaving a bare, undebuggable lock.
          config.demoMode ? Promise.resolve(null) : draftService.draftLockReason(cookie, token, league).catch(() => null),
        ]);

        // Posture — waiverPosture's rules, inlined so its reads (calLock/faOpen above) joined the batch
        // instead of running after it. Bias toward LOCKED when uncertain (freeAgencyOpen defaults false).
        let waiverState;
        let lockReason = null;
        if (config.demoMode) {
          waiverState = settings.system === 'free' ? 'fa_open' : 'waivers_soon';
        } else {
          const faOpenNow = !calLock && faOpen;
          const hasUpcomingRun = waiverRun != null && waiverRun > Date.now();
          waiverState = faOpenNow ? 'fa_open' : hasUpcomingRun ? 'waivers_soon' : 'locked';
          // Calendar reason first (direct), the draft state as the fallback — mirrors the cross-league
          // waiverLocks map so the wizard and the landing agree on why a league is locked.
          lockReason = waiverState === 'locked' ? (calLock || draftReason) : null;
        }
        const locked = waiverState === 'locked';

        const byeOf = (team) => (ctx.byeMap && ctx.byeMap[team] != null ? Number(ctx.byeMap[team]) : null);
        const projOf = (id) => (points && points.proj.get(String(id)) != null ? points.proj.get(String(id)) : null);
        const seasonOf = (id) => (points && points.season.get(String(id)) != null ? points.season.get(String(id)) : null);
        let freeAgents = fas;
        if (!config.demoMode) freeAgents = freeAgents.filter((p) => p.name && !/^Player \d+$/.test(p.name));
        freeAgents.sort((a, b) => (b.value || 0) - (a.value || 0));

        const full = rosterIsFull(roster, settings);
        // A deeper, position-diverse pool so the wizard can filter by position and
        // pick a different player — not just the single best add.
        const candidates = freeAgents.slice(0, 30).map((p) => ({
          id: p.id, name: p.name, position: p.position, team: p.team,
          value: p.value, projection: p.projection, trend: p.trend, ownership: p.ownership, availability: p.availability, bye: p.bye,
        }));
        // When the wizard is SEEDED with a specific player (the "claim in N leagues" hand-off), make him
        // the recommended add for this league — pulled to the front of the candidate list (fetched into
        // it if he's outside the top 30) — so the wizard opens on HIM with a smart drop/bid, not the
        // generic best-available. Falls back to the best add if he isn't a free agent here.
        let top = candidates[0] || null;
        if (seedAddId) {
          const inList = candidates.find((c) => String(c.id) === String(seedAddId));
          if (inList) {
            candidates.splice(candidates.indexOf(inList), 1);
            candidates.unshift(inList);
            top = inList;
          } else {
            const fa = freeAgents.find((p) => String(p.id) === String(seedAddId));
            if (fa) {
              const seedCand = { id: fa.id, name: fa.name, position: fa.position, team: fa.team, value: fa.value, projection: fa.projection, trend: fa.trend, ownership: fa.ownership, availability: fa.availability, bye: fa.bye };
              candidates.unshift(seedCand);
              top = seedCand;
            }
          }
        }
        // Suggested drop is add-position aware so it never proposes cutting your lone K/DEF unless the
        // pickup replaces that slot (a manual pick can still drop anyone).
        const drop = suggestDrop(roster, top ? top.position : null);

        // Position-then-value grouping so the wizard can show the whole depth chart at a glance
        // when choosing a drop. Starters are shown (marked, not droppable); bench is droppable. Each
        // rostered player carries this-week projection + this-year points so the drop card is rich.
        const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, PK: 4, DEF: 5 };
        const posRank = (pos) => (POS_ORDER[pos] != null ? POS_ORDER[pos] : 9);
        const byPosThenValue = (a, b) => posRank(a.position) - posRank(b.position) || (b.value || 0) - (a.value || 0);
        const toRow = (p, starter) => ({
          id: p.id, name: p.name, position: p.position, team: p.team, value: p.value,
          projection: projOf(p.id), seasonPoints: seasonOf(p.id),
          availability: p.availability, bye: byeOf(p.team), starter,
        });
        const rosterView = [...roster.starters.map((p) => toRow(p, true)), ...roster.bench.map((p) => toRow(p, false))].sort(byPosThenValue);
        // `bench` = the droppable set the wizard resolves a chosen drop against (kept for the
        // recommendation + the drop picker's selection map).
        const bench = roster.bench.map((p) => toRow(p, false)).sort(byPosThenValue);

        // Claims ALREADY submitted in this league — reconciled with MFL's authoritative queue so a
        // bid you placed on the MFL site (not just in-app) shows up too. Surfaced in the wizard so you
        // can see what's in before adding more. Fail-soft (never blocks a suggestion).
        let submitted = [];
        try {
          // `pend` came from the phase-2 parallel batch above (reconciledPending) — no second read.
          // Enrich each already-submitted claim with team + value on both the add and the drop, plus
          // the net dynasty value the move swings — so the wizard's "already submitted" strip carries
          // the same context as a live claim.
          const enrichSide = (p) => {
            if (!p) return null;
            const v = enr.value(p.id);
            const base = playersLib.resolve(byId, p.id);
            return { id: p.id, name: p.name, position: p.position, team: base.team || null, value: v != null ? v : null };
          };
          submitted = pend
            .filter((c) => (c.status || 'pending') === 'pending')
            .map((c) => {
              const add = enrichSide(c.add);
              const dropSide = enrichSide(c.drop);
              const valueDelta = add && add.value != null ? Math.round((add.value || 0) - (dropSide && dropSide.value != null ? dropSide.value : 0)) : null;
              return {
                id: c.id,
                add,
                drop: dropSide,
                valueDelta,
                bid: c.bid != null ? c.bid : null,
                priority: c.priority != null ? c.priority : null,
                source: c.source === 'mfl' ? 'mfl' : 'app',
              };
            });
        } catch (e) {
          submitted = [];
        }

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

        // waiverState / locked / lockReason were computed up top (posture, inlined into phase 2).
        return {
          leagueId: league.leagueId,
          name: league.name,
          system: settings.system,
          waiverState,
          nextWaiverRun: waiverRun,
          locked,
          lockReason,
          faabRemaining: settings.faabRemaining != null ? settings.faabRemaining : null,
          minBid: settings.minBid || 1,
          rosterCount: activeCount(roster),
          rosterSize: settings.rosterSize || null,
          rosterFull: full,
          clearTime: settings.clearTime || null,
          recommended: locked ? null : recommended,
          candidates,
          bench,
          roster: rosterView,
          submitted,
          // League + team context for the wizard header: format (Superflex/1QB + PPR + TE-premium),
          // and my dynasty posture (outlook + average roster age) so the pickup decision has context.
          context: {
            format: leagueFormat.label(fmt),
            superflex: fmt.numQbs >= 2,
            numQbs: fmt.numQbs,
            ppr: fmt.ppr,
            tep: !!fmt.tep,
            teStarters: fmt.teStarters || 0,
            outlook: roster.summary ? roster.summary.outlook || null : null,
            avgAge: roster.summary && roster.summary.avgAge != null ? roster.summary.avgAge : null,
            strengthLabel: roster.summary ? roster.summary.strengthLabel || null : null,
          },
        };
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, error: e.message };
      }
}

// All leagues at once (kept for compatibility). The mobile wizard now loads league-by-league via
// getLeagueSuggestion so the first step paints fast instead of waiting on the whole fan-out.
async function getSuggestions(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  // Each league now resolves its own lock/posture inside leagueSuggestionOne (no cross-league
  // precompute needed).
  const out = await Promise.all(leagues.map((league) => leagueSuggestionOne(cookie, token, league)));
  const summary = {
    total: out.length,
    withSuggestions: out.filter((l) => l.recommended && l.recommended.upgrade).length,
    withCandidates: out.filter((l) => l.candidates && l.candidates.length).length,
    // Leagues actionable now: FA open OR a run scheduled ahead (queue). This is the count the wizard
    // uses instead of "waivers open" — a FAAB league between runs is actionable, not closed.
    actionable: out.filter((l) => l.waiverState === 'fa_open' || l.waiverState === 'waivers_soon').length,
    locked: out.filter((l) => l.locked).length,
  };
  return { leagues: out, summary };
}

// ONE league's wizard suggestion, for the progressive wizard. Resolves its own lock reason (calendarLock)
// rather than the cross-league waiverLocks fan-out, so a single step costs only that league's reads.
async function getLeagueSuggestion(cookie, token, leagueId, { seedAddId = null } = {}) {
  const leagues = await leaguesService.listLeagues(cookie);
  const league = leagues.find((l) => String(l.leagueId) === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  return leagueSuggestionOne(cookie, token, league, { seedAddId });
}

// All pending claims + recent results across leagues, for one activity view. Pending is reconciled
// with MFL's authoritative queue per league (reconciledPending) so claims placed on the MFL site —
// not just through the app — show up. Results come from the transactions log. Both are per-league
// MFL reads, so fan them out in PARALLEL (cached, like the other cross-league views).
async function getPending(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const byId = await playersLib.load(cookie); // cached (Home/overview warmed it); used to resolve names
  const perLeague = await Promise.all(
    leagues.map(async (league) => {
      const [pend, rs, runMs] = await Promise.all([
        reconciledPending(cookie, token, league, byId),
        config.demoMode ? Promise.resolve(demo.waiverResults(league.leagueId)) : liveWaiverResults(cookie, league, byId),
        // The calendar gives a machine-readable next-run time — attach it so the Pending tab shows a
        // real countdown, not just MFL's human "Wed 3:00 AM" string (kept as the fallback label).
        config.demoMode ? Promise.resolve(null) : nextWaiverRun(cookie, league).catch(() => null),
      ]);
      const at = runMs ? new Date(runMs).toISOString() : null;
      // OUTBID losses (snapshot of our queued bids vs the wins), folded in alongside the won results.
      const lost = config.demoMode ? [] : await lostBidResults(cookie, token, league, byId, rs);
      const lostAddIds = new Set(lost.map((l) => String(l.addId)));
      const pending = pend
        .filter((c) => (c.status || 'pending') === 'pending' && !(c.add && lostAddIds.has(String(c.add.id))))
        .map((c) => ({ ...c, leagueId: league.leagueId, leagueName: league.name, at, atLabel: c.processTime || null }));
      const results = [...rs, ...lost].map(normResult).map((r) => ({ ...r, leagueId: league.leagueId, leagueName: league.name }));
      return { pending, results };
    })
  );
  const pending = perLeague.flatMap((x) => x.pending);
  const results = perLeague.flatMap((x) => x.results);
  return { pending, results, summary: { pending: pending.length, results: results.length } };
}

// Recent WON waiver claims across ALL your leagues — the source for the "you won a player" push. Wins
// come from MFL's transactions log (liveWaiverResults) which is READ-ONLY and idempotent, so this is
// safe to poll on the notification tick (unlike the outbid/lost reconcile, which mutates the pending
// snapshot and is left to getBoard). Each row: { leagueId, leagueName, add, addId, bid, at } — `at` is
// epoch seconds, used to dedup a claim across ticks. Best-effort per league.
async function recentResults(cookie, _token) {
  const leagues = await leaguesService.listLeagues(cookie).catch(() => []);
  const norm = (leagueId, leagueName, r) => ({
    leagueId, leagueName, add: r.add, addId: r.addId != null ? String(r.addId) : null,
    bid: r.bid != null ? r.bid : null, at: r.at || 0,
  });
  if (config.demoMode) {
    const out = [];
    for (const lg of leagues) {
      for (const r of demo.waiverResults(lg.leagueId) || []) {
        if ((r.result || 'won') === 'won') out.push(norm(lg.leagueId, lg.name, r));
      }
    }
    return { results: out };
  }
  const byId = await playersLib.load(cookie).catch(() => new Map());
  const per = await Promise.all(
    leagues.map(async (league) => {
      const wins = await liveWaiverResults(cookie, league, byId).catch(() => []);
      return wins.filter((r) => (r.result || 'won') === 'won').map((r) => norm(league.leagueId, league.name, r));
    })
  );
  return { results: per.flat() };
}

module.exports = { getBoard, getOverview, getSuggestions, getLeagueSuggestion, preview, submit, previewMulti, submitMulti, cancel, edit, reorder, getBestAvailable, getPending, freeAgentIds, invalidate, nextWaiverRun, reconciledPending, recentResults };
