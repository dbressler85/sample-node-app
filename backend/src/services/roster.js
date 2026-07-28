'use strict';

// Roster for one franchise in one league, with player ids resolved to names.

const mfl = require('../lib/mfl');
const mflRepo = require('../lib/mflRepo');
const config = require('../config');
const demo = require('../demo/fixtures');
const players = require('../lib/players');
const availabilityLib = require('../lib/availability');
const nflLib = require('../lib/nfl');
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');
const picksLib = require('../lib/picks');
const rosterStatus = require('../lib/rosterStatus');
const rosterMoves = require('../store/rosterMoves');
const { createMemo } = require('../lib/memo');
const leaguesService = require('./leagues');

// Assembling a roster means several MFL reads (roster, injuries, byes, picks) plus
// enrichment and per-player availability work, and getRoster is called repeatedly
// for the same league across one screen (lineups, on-deck, portfolio, trades all
// pull it). Memoize the assembled result per (cookie, league) on the short TTL,
// coalescing concurrent builds; writes to a league invalidate its entry.
const rosterMemo = createMemo({ ttlMs: config.mflCacheTtlMs });

// Attach dynasty context (age, value) and availability to a resolved player.
function enrich(player, ctx) {
  return {
    ...player,
    age: ctx.enr.age(player.id),
    value: ctx.enr.value(player.id),
    // Win-now (redraft) value ≈ this-season role/production, and unlike dynasty value it isn't
    // age-discounted — so it's our best on-hand proxy for "how much does he actually play now,"
    // used to weight the core-age read (below).
    winNow: ctx.enr.winNow ? ctx.enr.winNow(player.id) : null,
    availability: availabilityLib.resolve(player, ctx.statusMap, ctx.byeMap, ctx.week),
  };
}

// Dynasty outlook from THREE signals, not age alone:
//   * strengthPct — where this roster's total value ranks among the league's teams
//     (0..1; 1.0 = the strongest roster). "Are you actually good on paper?"
//   * coreAge — average age of the five most valuable players. "Which way is the
//     window pointing?"
//   * recordPct — where this team's actual W-L / points ranks in the standings
//     (0..1; 1.0 = best record). "Is THIS season still live?" — null in the preseason
//     or when standings can't be read, so it only ever refines the roster-based read.
// Age+strength alone misread season reality: a stacked veteran roster sitting at 2-8 read
// "Win-now window" even though this year is already lost, and a middling roster on a real
// playoff run got no credit for it. Record fixes both. Four exhaustive buckets so they
// always sum to your league count:
//   Win-now window — strong roster (or a middling one that's WINNING), core not young.
//   Ascending      — young core that isn't bottom-tier → a winner is forming.
//   Rebuilding     — bottom-half roster → accumulate youth & picks.
//   Balanced       — middling on both axes (incl. a stacked roster whose season is lost).
// When strength is unknown it degrades to an age lean; when record is unknown it degrades
// to the roster-only read (identical to before), so nothing regresses without standings.
function computeOutlook(coreAge, strengthPct, recordPct) {
  if (coreAge == null) return 'Balanced';
  const strong = strengthPct != null && strengthPct >= 0.55;
  const weak = strengthPct != null && strengthPct <= 0.45;
  const young = coreAge <= 24.5;
  // Season reality, only when we have a played record. Both thresholds are conservative "thirds":
  // out-of-it = bottom third of the standings; contending (used only to PROMOTE a middling roster to
  // win-now) = top third, so a merely-.500 team doesn't get bumped.
  const outOfIt = recordPct != null && recordPct <= 0.34;
  const contendingRecord = recordPct != null && recordPct >= 0.66;

  // Stacked veteran roster: contend now — UNLESS the record says the season's already gone,
  // in which case pushing win-now chips is the wrong call (→ Balanced / consider retooling).
  if (strong && !young) return outOfIt ? 'Balanced' : 'Win-now window';
  if (young && !weak) return 'Ascending';
  if (weak) return 'Rebuilding';
  // Middling roster (neither strong nor weak) riding a top-third record → a real buy-now window.
  if (contendingRecord && !young) return 'Win-now window';
  return 'Balanced';
}

// Percentile of each franchise by ACTUAL season record — win% (ties = half a win), tie-broken by
// points-for — 0..1 where 1.0 = the best record in the league. Returns a Map(id → pct); empty when
// standings are unreadable or no games have been played yet (preseason), so outlook cleanly falls
// back to the roster-only read. Works on both live and demo standings rows (h2hw/h2hl/h2ht/pf).
function recordPctByFranchise(standingsRows) {
  const rows = Array.isArray(standingsRows) ? standingsRows : [];
  const scored = rows.map((f) => {
    const w = mfl.num(f && f.h2hw) || 0;
    const l = mfl.num(f && f.h2hl) || 0;
    const t = mfl.num(f && f.h2ht) || 0;
    const games = w + l + t;
    // Rank key: win% dominates, points-for breaks ties (both scaled so pf never outweighs a win).
    return { id: String(f && f.id), games, key: (games ? (w + 0.5 * t) / games : 0) * 1e6 + (mfl.num(f && f.pf) || 0) };
  });
  const map = new Map();
  if (scored.length < 2 || !scored.some((s) => s.games > 0)) return map; // preseason / unreadable
  for (const s of scored) {
    const atOrBelow = scored.filter((o) => o.key <= s.key).length;
    map.set(s.id, atOrBelow / scored.length);
  }
  return map;
}

// One franchise's raw current-season record from the standings rows → { wins, losses, ties } (null
// until games are played / when standings can't be read). Surfaced on the team summary so screens
// that help you decide buy-vs-sell (trade block, trade desk) can show "you're 2-8" alongside outlook.
function recordForFranchise(standingsRows, franchiseId) {
  const row = (Array.isArray(standingsRows) ? standingsRows : []).find((f) => String(f && f.id) === String(franchiseId));
  if (!row) return null;
  const wins = mfl.num(row.h2hw) || 0;
  const losses = mfl.num(row.h2hl) || 0;
  const ties = mfl.num(row.h2ht) || 0;
  return wins + losses + ties > 0 ? { wins, losses, ties } : null;
}

// Roster strength as a plain qualitative tag from where its value ranks in the league — the
// human-readable companion to `strengthPct` and the SAME 0.55/0.45 thresholds `computeOutlook`
// uses, so the label and the outlook can never disagree. Exported so the client renders this
// string instead of re-deriving the thresholds (they used to be hardcoded in two places).
function strengthLabel(strengthPct) {
  if (strengthPct == null) return null;
  if (strengthPct >= 0.55) return 'strong roster';
  if (strengthPct <= 0.45) return 'thin roster';
  return 'middle of the pack';
}

// Team-level dynasty snapshot: total asset value, average age, core age, this
// roster's strength percentile in its league, and the blended outlook.
// Core age = the average age of a team's PRODUCTION core, not its most-valuable-on-paper core.
// Selecting the top five by dynasty value quietly excluded aging on-field studs — value is
// age-discounted, so a productive 30-year-old sinks below a younger bench asset and drops out of
// the "how old is your core" average, making aging teams read younger than they actually play.
// Ranking by win-now (redraft) value instead — which tracks this-season role and isn't
// age-penalized — keeps those studs in the core, so the age reflects who you really field. Falls
// back to dynasty value when a player has no win-now number (e.g. demo, or FC didn't cover him).
function coreAgeOf(players) {
  const valued = (players || []).filter((p) => p.value != null && p.age != null);
  if (!valued.length) return null;
  const weight = (p) => (p.winNow != null ? p.winNow : (p.value || 0));
  const core = valued.slice().sort((a, b) => weight(b) - weight(a)).slice(0, 5);
  return core.length ? Math.round((core.reduce((s, p) => s + p.age, 0) / core.length) * 10) / 10 : null;
}

function teamSummary(all, strengthPct, recordPct, record) {
  const valued = all.filter((p) => p.value != null);
  const rosterValue = valued.reduce((s, p) => s + p.value, 0);
  const avgAge = valued.length ? Math.round((valued.reduce((s, p) => s + (p.age || 0), 0) / valued.length) * 10) / 10 : null;
  const coreAge = coreAgeOf(all);
  const strength = strengthPct != null ? Math.round(strengthPct * 100) / 100 : null;
  return { rosterValue, avgAge, coreAge, strengthPct: strength, strengthLabel: strengthLabel(strengthPct), record: record || null, outlook: computeOutlook(coreAge, strengthPct, recordPct) };
}

// My roster's value rank among all franchises in the league (0..1; 1.0 = strongest).
// Each franchise's strength is the sum of its players' dynasty values (same enrichment
// snapshot the rest of the roster uses). Returns null if we can't see enough teams.
function leagueStrengthPct(franchises, myId, enr) {
  if (!Array.isArray(franchises) || franchises.length < 2) return null;
  const totals = franchises.map((f) => ({
    id: String(f.id),
    total: mfl.toArray(f.player).reduce((s, p) => s + (enr.value(String(p.id)) || 0), 0),
  }));
  const mine = totals.find((t) => t.id === String(myId));
  if (!mine || !mine.total) return null;
  const atOrBelow = totals.filter((t) => t.total <= mine.total).length;
  return atOrBelow / totals.length;
}

// Bucket one franchise's player id-list into starters/bench/ir/taxi. Slot detection (which accepts
// both MFL status vocabularies) lives in lib/rosterStatus so every consumer agrees; `starter` → the
// starters bucket, a plain active player → bench.
const SLOT_BUCKET = { ir: 'ir', taxi: 'taxi', starter: 'starters', active: 'bench' };
function bucketPlayers(franchisePlayers) {
  const buckets = { starters: [], bench: [], ir: [], taxi: [] };
  for (const p of mfl.toArray(franchisePlayers)) buckets[SLOT_BUCKET[rosterStatus.rosterSlot(p)]].push(String(p.id));
  return buckets;
}

async function findLeague(cookie, leagueId) {
  const leagues = await leaguesService.listLeagues(cookie);
  return leagues.find((l) => l.leagueId === String(leagueId)) || null;
}

// Pull every franchise's raw roster in the league (one MFL read). We need the whole
// league — not just my team — to rank roster strength. Returns the franchise array
// (each { id, player: [...] }). Demo returns null (no full league in fixtures; we use
// a strength fixture instead).
async function allFranchiseRosters(league, cookie) {
  if (config.demoMode) return null;
  return mflRepo.rosters(league, cookie);
}

// My raw roster id-lists (starters/bench/ir/taxi), from the all-franchise response
// in live mode or the fixture in demo.
function myBuckets(franchises, league) {
  if (config.demoMode) return rosterMoves.apply(league.leagueId, demo.roster(league.leagueId) || { starters: [], bench: [], ir: [], taxi: [] });
  const mine = (franchises || []).find((f) => String(f.id) === league.franchiseId) || (franchises || [])[0];
  return mine ? bucketPlayers(mine.player) : { starters: [], bench: [], ir: [], taxi: [] };
}

// A LIGHT read of just my roster's buckets ({starters,bench,ir,taxi} of {id}) — no
// enrichment, no all-franchise valuation, no strength, no availability. For cross-league
// "where do I own this player" sets (Players screen, watchlist) that only need ids, this
// is far cheaper than the full getRoster build. Live reads only my franchise (FRANCHISE=me).
// My franchise's raw roster buckets ({starters,bench,ir,taxi} of player-id strings), from the
// LIGHT single-franchise read (live) or the fixture (demo) — no all-franchise fetch. Shared by
// myRosterLight (ids only) and myRosterEnriched (ids + enrichment).
async function myBucketIds(cookie, league) {
  if (config.demoMode) return rosterMoves.apply(league.leagueId, demo.roster(league.leagueId) || { starters: [], bench: [], ir: [], taxi: [] });
  const franchises = await mflRepo.rosters(league, cookie, { FRANCHISE: league.franchiseId });
  const mine = franchises.find((f) => String(f.id) === league.franchiseId) || franchises[0];
  return mine ? bucketPlayers(mine.player) : { starters: [], bench: [], ir: [], taxi: [] };
}

async function myRosterLight(cookie, leagueId) {
  const league = await findLeague(cookie, leagueId);
  if (!league) return null;
  const buckets = await myBucketIds(cookie, league);
  const wrap = (ids) => (ids || []).map((id) => ({ id: String(id) }));
  return { leagueId: String(leagueId), starters: wrap(buckets.starters), bench: wrap(buckets.bench), ir: wrap(buckets.ir), taxi: wrap(buckets.taxi) };
}

// My roster with each player ENRICHED (name/position/team/age/value/availability), but WITHOUT
// the all-franchise fetch, strength ranking, picks, or summary that getRoster carries. For a
// cross-league fan-out that needs my valued players by bucket (exposure) but not the rival
// context. Reuses the exact enrich() + snapshot so the player objects match getRoster's.
async function myRosterEnriched(cookie, leagueId) {
  const league = await findLeague(cookie, leagueId);
  if (!league) return null;
  const week = config.demoMode ? demo.week() : await nflLib.currentWeek(cookie);
  const [byId, statusMap, byeMap, enr, src] = await Promise.all([
    players.load(cookie),
    config.demoMode ? Promise.resolve(demo.playerStatus()) : nflLib.injuryMap(cookie, week),
    config.demoMode ? Promise.resolve(demo.byes()) : nflLib.byeMap(cookie, week),
    leagueFormat.format(cookie, league).then((fmt) => enrichmentLib.snapshot(fmt, cookie)),
    myBucketIds(cookie, league),
  ]);
  const ctx = { week, statusMap, byeMap, enr };
  const map = (ids) => (ids || []).map((id) => enrich(players.resolve(byId, id), ctx));
  return {
    leagueId: league.leagueId,
    name: league.name,
    franchiseId: league.franchiseId,
    starters: map(src.starters),
    bench: map(src.bench),
    ir: map(src.ir),
    taxi: map(src.taxi),
  };
}

async function getRoster(cookie, leagueId) {
  if (config.demoMode) return buildRoster(cookie, leagueId);
  return rosterMemo.get(`${cookie}|${leagueId}`, () => buildRoster(cookie, leagueId));
}

// Drop the cached roster for a league after a write to it (lineup set, add/drop,
// waiver processed), so the next read reflects the change. Also clears the raw MFL
// reads for that league.
function invalidate(cookie, leagueId) {
  rosterMemo.invalidate(`${cookie}|${leagueId}`);
  mfl.invalidateLeague(cookie, leagueId);
}

// Assemble the enriched roster from ALREADY-FETCHED franchises + the resolved context (player DB,
// injury/bye maps, enrichment snapshot, my picks). The post-fetch half of buildRoster, factored out so
// the SAME bucketing + strength + summary logic serves both the backend's own MFL read and a
// device-origin read where the franchises were fetched on-device (docs/DEVICE_ORIGIN_MFL.md). Pure over
// its inputs (no MFL reads); `franchises` is the raw `rosters` export array (null in demo → demo buckets).
function assembleRoster(league, franchises, ctx) {
  const { byId, week, statusMap, byeMap, enr, picks = [], recordPct = null, record = null } = ctx;
  const src = myBuckets(franchises, league);
  const c = { week, statusMap, byeMap, enr };
  const map = (ids) => (ids || []).map((id) => enrich(players.resolve(byId, id), c));
  const roster = {
    leagueId: league.leagueId,
    name: league.name,
    franchiseId: league.franchiseId,
    franchiseName: league.franchiseName,
    starters: map(src.starters),
    bench: map(src.bench),
    ir: map(src.ir),
    taxi: map(src.taxi),
    // Format-aware pick value (FantasyCalc per-slot for this league's format, else the local curve).
    picks: (picks || []).map((p) => ({ ...p, value: picksLib.value(p.label, p.token, enr) })),
  };
  // Strength percentile: demo uses a fixture (no full league in fixtures); live ranks
  // my roster value against every franchise's, using the same enrichment snapshot.
  const strengthPct = config.demoMode ? demo.teamStrength(league.leagueId) : leagueStrengthPct(franchises, league.franchiseId, enr);
  roster.summary = teamSummary([...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi], strengthPct, recordPct, record);
  return roster;
}

async function buildRoster(cookie, leagueId) {
  const league = await findLeague(cookie, leagueId);
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }

  const week = config.demoMode ? demo.week() : await nflLib.currentWeek(cookie);
  // Chain format -> snapshot inside the Promise.all so format's league/rules reads
  // (on a cold cache) overlap the roster/injury/bye/picks reads instead of running
  // serially ahead of them.
  const [franchises, byId, statusMap, byeMap, picks, enr, standingsRows] = await Promise.all([
    allFranchiseRosters(league, cookie),
    players.load(cookie),
    config.demoMode ? Promise.resolve(demo.playerStatus()) : nflLib.injuryMap(cookie, week),
    config.demoMode ? Promise.resolve(demo.byes()) : nflLib.byeMap(cookie, week),
    // Picks as first-class assets: token (so they can be shopped/traded), label, year/round,
    // and dynasty value — sorted soonest-first (year, then round).
    picksLib.franchisePicks(cookie, league).then((list) => list
      // value is filled in assembleRoster (needs the enrichment snapshot for format-aware pick values).
      .map((p) => ({ token: p.token, label: p.label, year: p.year, round: p.round }))
      .sort((a, b) => (a.year || 9999) - (b.year || 9999) || (a.round || 99) - (b.round || 99))),
    leagueFormat.format(cookie, league).then((fmt) => enrichmentLib.snapshot(fmt, cookie)),
    // Actual season record → outlook's "is this season live?" axis. Best-effort: a standings miss
    // just means outlook falls back to the roster-only read (never blocks the roster).
    (config.demoMode ? Promise.resolve(demo.standings(league.leagueId)) : mflRepo.standings(league, cookie)).catch(() => null),
  ]);
  const recordPct = recordPctByFranchise(standingsRows).get(String(league.franchiseId)) ?? null;
  const record = recordForFranchise(standingsRows, league.franchiseId);
  return assembleRoster(league, franchises, { byId, week, statusMap, byeMap, enr, picks, recordPct, record });
}

// Build my enriched roster (+ strength summary) from franchises the DEVICE fetched straight from MFL,
// instead of the backend fetching them — the roster half of a device-origin portfolio read
// (docs/DEVICE_ORIGIN_MFL.md). The heavy all-franchise `rosters` fan-out leaves the server; only the
// GLOBAL/cached context (player DB, injury/bye, value snapshot) is resolved here. Picks are omitted (the
// portfolio dashboard doesn't use them, and they'd re-introduce a per-franchise MFL read). NOT memoized —
// the shared roster memo stays backend-authoritative for the read screens.
async function rosterFromDeviceFranchises(cookie, league, franchises) {
  const week = config.demoMode ? demo.week() : await nflLib.currentWeek(cookie);
  const [byId, statusMap, byeMap, enr] = await Promise.all([
    players.load(cookie),
    config.demoMode ? Promise.resolve(demo.playerStatus()) : nflLib.injuryMap(cookie, week),
    config.demoMode ? Promise.resolve(demo.byes()) : nflLib.byeMap(cookie, week),
    leagueFormat.format(cookie, league).then((fmt) => enrichmentLib.snapshot(fmt, cookie)),
  ]);
  return assembleRoster(league, franchises, { byId, week, statusMap, byeMap, enr, picks: [] });
}

// Every franchise in a league with its roster valued and broken out by position —
// the basis for "which rival would want this player" suggestions. Live reads all
// rosters (one call, cached); demo composes from my roster + the partner fixtures.
async function leagueFranchises(cookie, leagueId) {
  const league = await findLeague(cookie, leagueId);
  if (!league) return [];
  const [byId, enr] = await Promise.all([
    players.load(cookie),
    leagueFormat.format(cookie, league).then((fmt) => enrichmentLib.snapshot(fmt, cookie)),
  ]);

  let raw; // [{ franchiseId, name, mine, playerIds }]
  if (config.demoMode) {
    const b = demo.roster(leagueId) || { starters: [], bench: [], ir: [], taxi: [] };
    const mineIds = [...b.starters, ...b.bench, ...b.ir, ...b.taxi].map(String);
    raw = [{ franchiseId: league.franchiseId, name: league.franchiseName || 'My Team', mine: true, playerIds: mineIds }];
    for (const p of demo.tradePartners(leagueId)) {
      raw.push({ franchiseId: String(p.franchiseId), name: p.name, mine: false, playerIds: (p.roster || []).map(String) });
    }
  } else {
    const [franchises, names] = await Promise.all([
      allFranchiseRosters(league, cookie),
      leaguesService.franchiseNames(cookie, league),
    ]);
    raw = (franchises || []).map((f) => ({
      franchiseId: String(f.id),
      name: names.get(String(f.id)) || `Team ${f.id}`,
      mine: String(f.id) === league.franchiseId,
      playerIds: mfl.toArray(f.player).map((p) => String(p.id)),
    }));
  }

  return raw.map((fr) => {
    const byPos = {};
    let totalValue = 0;
    for (const id of fr.playerIds) {
      const pos = players.resolve(byId, id).position || '?';
      const v = enr.value(id) || 0;
      totalValue += v;
      (byPos[pos] || (byPos[pos] = [])).push(v);
    }
    const posStats = {};
    for (const [pos, vals] of Object.entries(byPos)) {
      vals.sort((a, b) => b - a);
      posStats[pos] = { best: vals[0] || 0, depth: vals.length };
    }
    return { franchiseId: fr.franchiseId, name: fr.name, mine: fr.mine, totalValue: Math.round(totalValue), byPos: posStats };
  });
}

// Move players between the active roster and Injured Reserve. `activate` = IR → active,
// `deactivate` = active → IR, `drop` = release. Live writes MFL's owner-accessible `ir` import
// (eligibility — a DEACTIVATE needs an injured designation — is enforced by MFL; we surface its
// error); demo records the move in the overlay so the roster reflects it. Returns the fresh roster.
async function moveIr(cookie, token, leagueId, { activate = [], deactivate = [], drop = [] } = {}) {
  const league = await findLeague(cookie, leagueId);
  if (!league) { const e = new Error(`League ${leagueId} not found for this account`); e.status = 404; throw e; }
  const csv = (a) => (a && a.length ? a.map(String).join(',') : undefined);
  if (!config.demoMode) {
    await mfl.importRequest('ir', { host: league.host, cookie, L: league.leagueId, ACTIVATE: csv(activate), DEACTIVATE: csv(deactivate), DROP: csv(drop) });
    invalidate(cookie, leagueId);
  } else {
    for (const id of activate) rosterMoves.set(leagueId, id, 'active');
    for (const id of deactivate) rosterMoves.set(leagueId, id, 'ir');
    for (const id of drop) rosterMoves.set(leagueId, id, 'dropped');
  }
  return getRoster(cookie, leagueId);
}

// Move players between the active roster and the Taxi Squad. `promote` = taxi → active,
// `demote` = active → taxi, `drop` = release. Live writes MFL's owner-accessible `taxi_squad`
// import (taxi eligibility — rookie/young — is enforced by MFL; we surface its error); demo records
// the move in the overlay. Returns the fresh roster.
async function moveTaxi(cookie, token, leagueId, { promote = [], demote = [], drop = [] } = {}) {
  const league = await findLeague(cookie, leagueId);
  if (!league) { const e = new Error(`League ${leagueId} not found for this account`); e.status = 404; throw e; }
  const csv = (a) => (a && a.length ? a.map(String).join(',') : undefined);
  if (!config.demoMode) {
    await mfl.importRequest('taxi_squad', { host: league.host, cookie, L: league.leagueId, PROMOTE: csv(promote), DEMOTE: csv(demote), DROP: csv(drop) });
    invalidate(cookie, leagueId);
  } else {
    for (const id of promote) rosterMoves.set(leagueId, id, 'active');
    for (const id of demote) rosterMoves.set(leagueId, id, 'taxi');
    for (const id of drop) rosterMoves.set(leagueId, id, 'dropped');
  }
  return getRoster(cookie, leagueId);
}

module.exports = { getRoster, invalidate, computeOutlook, coreAgeOf, recordPctByFranchise, recordForFranchise, strengthLabel, leagueFranchises, myRosterLight, myRosterEnriched, rosterFromDeviceFranchises, assembleRoster, moveIr, moveTaxi };
