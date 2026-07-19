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
const leaguesService = require('./leagues');

// Attach dynasty context (age, value) and availability to a resolved player.
function enrich(player, ctx) {
  return {
    ...player,
    age: ctx.enr.age(player.id),
    value: ctx.enr.value(player.id),
    availability: availabilityLib.resolve(player, ctx.statusMap, ctx.byeMap, ctx.week),
  };
}

// Team-level dynasty snapshot: total asset value, average age, and a rough
// contender/rebuild outlook from the age of the most valuable core.
function teamSummary(all) {
  const valued = all.filter((p) => p.value != null);
  const rosterValue = valued.reduce((s, p) => s + p.value, 0);
  const avgAge = valued.length ? Math.round((valued.reduce((s, p) => s + (p.age || 0), 0) / valued.length) * 10) / 10 : null;
  const core = valued.slice().sort((a, b) => b.value - a.value).slice(0, 5);
  const coreAge = core.length ? Math.round((core.reduce((s, p) => s + (p.age || 0), 0) / core.length) * 10) / 10 : null;
  let outlook = 'Balanced';
  if (coreAge != null) outlook = coreAge <= 24.5 ? 'Ascending' : coreAge >= 28 ? 'Win-now window' : 'Balanced';
  return { rosterValue, avgAge, coreAge, outlook };
}

async function findLeague(cookie, leagueId) {
  const leagues = await leaguesService.listLeagues(cookie);
  return leagues.find((l) => l.leagueId === String(leagueId)) || null;
}

// Pull raw roster id-lists for my franchise (starters/bench/ir/taxi).
async function rawRoster(league, cookie) {
  if (config.demoMode) return demo.roster(league.leagueId);

  const res = await mfl.exportRequest('rosters', {
    host: league.host,
    cookie,
    L: league.leagueId,
    FRANCHISE: league.franchiseId,
  });
  const franchises = mfl.toArray(res && res.rosters && res.rosters.franchise);
  const mine = franchises.find((f) => String(f.id) === league.franchiseId) || franchises[0];
  if (!mine) return { starters: [], bench: [], ir: [], taxi: [] };

  // MFL marks lineup status per player: status "starter", plus roster_status
  // flags for IR / taxi squad. We bucket by those flags.
  const buckets = { starters: [], bench: [], ir: [], taxi: [] };
  for (const p of mfl.toArray(mine.player)) {
    const id = String(p.id);
    if (p.status === 'INJURED_RESERVE' || p.roster_status === 'INJURED_RESERVE') buckets.ir.push(id);
    else if (p.status === 'TAXI_SQUAD' || p.roster_status === 'TAXI_SQUAD') buckets.taxi.push(id);
    else if (p.status === 'starter') buckets.starters.push(id);
    else buckets.bench.push(id);
  }
  return buckets;
}

async function getRoster(cookie, leagueId) {
  const league = await findLeague(cookie, leagueId);
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }

  const week = config.demoMode ? demo.week() : Number(process.env.MFL_WEEK) || null;
  const fmt = await leagueFormat.format(cookie, league);
  const [raw, byId, statusMap, byeMap, picks, enr] = await Promise.all([
    rawRoster(league, cookie),
    players.load(cookie),
    config.demoMode ? Promise.resolve(demo.playerStatus()) : nflLib.injuryMap(cookie, week),
    config.demoMode ? Promise.resolve(demo.byes()) : nflLib.byeMap(cookie, week),
    picksLib.franchisePicks(cookie, league).then((list) => list.map((p) => p.label)),
    enrichmentLib.snapshot(fmt, cookie),
  ]);
  const empty = { starters: [], bench: [], ir: [], taxi: [] };
  const src = raw || empty;

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
  roster.summary = teamSummary([...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi]);
  return roster;
}

module.exports = { getRoster };
