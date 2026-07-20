'use strict';

// Roster for one franchise in one league, with player ids resolved to names.

const mfl = require('../lib/mfl');
const config = require('../config');
const demo = require('../demo/fixtures');
const players = require('../lib/players');
const availabilityLib = require('../lib/availability');
const nflLib = require('../lib/nfl');
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');
const picksLib = require('../lib/picks');
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

// Bucket one franchise's player id-list into starters/bench/ir/taxi.
function bucketPlayers(franchisePlayers) {
  const buckets = { starters: [], bench: [], ir: [], taxi: [] };
  for (const p of mfl.toArray(franchisePlayers)) {
    const id = String(p.id);
    if (p.status === 'INJURED_RESERVE' || p.roster_status === 'INJURED_RESERVE') buckets.ir.push(id);
    else if (p.status === 'TAXI_SQUAD' || p.roster_status === 'TAXI_SQUAD') buckets.taxi.push(id);
    else if (p.status === 'starter') buckets.starters.push(id);
    else buckets.bench.push(id);
  }
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
  const res = await mfl.exportRequest('rosters', { host: league.host, cookie, L: league.leagueId });
  return mfl.toArray(res && res.rosters && res.rosters.franchise);
}

// My raw roster id-lists (starters/bench/ir/taxi), from the all-franchise response
// in live mode or the fixture in demo.
function myBuckets(franchises, league) {
  if (config.demoMode) return demo.roster(league.leagueId) || { starters: [], bench: [], ir: [], taxi: [] };
  const mine = (franchises || []).find((f) => String(f.id) === league.franchiseId) || (franchises || [])[0];
  return mine ? bucketPlayers(mine.player) : { starters: [], bench: [], ir: [], taxi: [] };
}

// A LIGHT read of just my roster's buckets ({starters,bench,ir,taxi} of {id}) — no
// enrichment, no all-franchise valuation, no strength, no availability. For cross-league
// "where do I own this player" sets (Players screen, watchlist) that only need ids, this
// is far cheaper than the full getRoster build. Live reads only my franchise (FRANCHISE=me).
async function myRosterLight(cookie, leagueId) {
  const league = await findLeague(cookie, leagueId);
  if (!league) return null;
  let buckets;
  if (config.demoMode) {
    buckets = demo.roster(leagueId) || { starters: [], bench: [], ir: [], taxi: [] };
  } else {
    const res = await mfl.exportRequest('rosters', { host: league.host, cookie, L: league.leagueId, FRANCHISE: league.franchiseId });
    const franchises = mfl.toArray(res && res.rosters && res.rosters.franchise);
    const mine = franchises.find((f) => String(f.id) === league.franchiseId) || franchises[0];
    buckets = mine ? bucketPlayers(mine.player) : { starters: [], bench: [], ir: [], taxi: [] };
  }
  const wrap = (ids) => (ids || []).map((id) => ({ id: String(id) }));
  return { leagueId: String(leagueId), starters: wrap(buckets.starters), bench: wrap(buckets.bench), ir: wrap(buckets.ir), taxi: wrap(buckets.taxi) };
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
    picksLib.franchisePicks(cookie, league).then((list) => list.map((p) => p.label)),
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

module.exports = { getRoster, invalidate, computeOutlook, leagueFranchises, myRosterLight };
