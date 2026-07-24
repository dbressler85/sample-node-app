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
    availability: availabilityLib.resolve(player, ctx.statusMap, ctx.byeMap, ctx.week),
  };
}

// Dynasty outlook from TWO signals, not age alone:
//   * strengthPct — where this roster's total value ranks among the league's teams
//     (0..1; 1.0 = the strongest roster). "Are you actually good?"
//   * coreAge — average age of the five most valuable players. "Which way is the
//     window pointing?"
// Age-only was misleading: two young teams looked identical even if one was stacked
// and the other threadbare. Blending strength fixes that. Four exhaustive buckets so
// they always sum to your league count:
//   Win-now window — strong roster, core not young → contend now (urgent if aging).
//   Ascending      — young core that isn't bottom-tier → a winner is forming.
//   Rebuilding     — bottom-half roster → accumulate youth & picks.
//   Balanced       — middling on both axes.
// When strength is unknown (can't read the league's other rosters), it degrades to
// an age lean (young → Ascending, else Balanced) rather than guessing win-now/rebuild.
function computeOutlook(coreAge, strengthPct) {
  if (coreAge == null) return 'Balanced';
  const strong = strengthPct != null && strengthPct >= 0.55;
  const weak = strengthPct != null && strengthPct <= 0.45;
  const young = coreAge <= 24.5;
  if (strong && !young) return 'Win-now window';
  if (young && !weak) return 'Ascending';
  if (weak) return 'Rebuilding';
  return 'Balanced';
}

// Team-level dynasty snapshot: total asset value, average age, core age, this
// roster's strength percentile in its league, and the blended outlook.
function teamSummary(all, strengthPct) {
  const valued = all.filter((p) => p.value != null);
  const rosterValue = valued.reduce((s, p) => s + p.value, 0);
  const avgAge = valued.length ? Math.round((valued.reduce((s, p) => s + (p.age || 0), 0) / valued.length) * 10) / 10 : null;
  const core = valued.slice().sort((a, b) => b.value - a.value).slice(0, 5);
  const coreAge = core.length ? Math.round((core.reduce((s, p) => s + (p.age || 0), 0) / core.length) * 10) / 10 : null;
  const strength = strengthPct != null ? Math.round(strengthPct * 100) / 100 : null;
  return { rosterValue, avgAge, coreAge, strengthPct: strength, outlook: computeOutlook(coreAge, strengthPct) };
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
  const [franchises, byId, statusMap, byeMap, picks, enr] = await Promise.all([
    allFranchiseRosters(league, cookie),
    players.load(cookie),
    config.demoMode ? Promise.resolve(demo.playerStatus()) : nflLib.injuryMap(cookie, week),
    config.demoMode ? Promise.resolve(demo.byes()) : nflLib.byeMap(cookie, week),
    // Picks as first-class assets: token (so they can be shopped/traded), label, year/round,
    // and dynasty value — sorted soonest-first (year, then round).
    picksLib.franchisePicks(cookie, league).then((list) => list
      .map((p) => ({ token: p.token, label: p.label, year: p.year, round: p.round, value: picksLib.value(p.label) }))
      .sort((a, b) => (a.year || 9999) - (b.year || 9999) || (a.round || 99) - (b.round || 99))),
    leagueFormat.format(cookie, league).then((fmt) => enrichmentLib.snapshot(fmt, cookie)),
  ]);
  const src = myBuckets(franchises, league);

  const ctx = { week, statusMap, byeMap, enr };
  const map = (ids) => (ids || []).map((id) => enrich(players.resolve(byId, id), ctx));

  const roster = {
    leagueId: league.leagueId,
    name: league.name,
    franchiseId: league.franchiseId,
    franchiseName: league.franchiseName,
    starters: map(src.starters),
    bench: map(src.bench),
    ir: map(src.ir),
    taxi: map(src.taxi),
    picks,
  };
  // Strength percentile: demo uses a fixture (no full league in fixtures); live ranks
  // my roster value against every franchise's, using the same enrichment snapshot.
  const strengthPct = config.demoMode ? demo.teamStrength(leagueId) : leagueStrengthPct(franchises, league.franchiseId, enr);
  roster.summary = teamSummary([...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi], strengthPct);
  return roster;
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

module.exports = { getRoster, invalidate, computeOutlook, leagueFranchises, myRosterLight, myRosterEnriched, moveIr, moveTaxi };
