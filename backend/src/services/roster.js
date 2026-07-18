'use strict';

// Roster for one franchise in one league, with player ids resolved to names.

const mfl = require('../lib/mfl');
const config = require('../config');
const demo = require('../demo/fixtures');
const players = require('../lib/players');
const leaguesService = require('./leagues');

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

  const [raw, byId] = await Promise.all([rawRoster(league, cookie), players.load(cookie)]);
  const empty = { starters: [], bench: [], ir: [], taxi: [] };
  const src = raw || empty;

  const map = (ids) => (ids || []).map((id) => players.resolve(byId, id));

  return {
    leagueId: league.leagueId,
    name: league.name,
    franchiseId: league.franchiseId,
    franchiseName: league.franchiseName,
    starters: map(src.starters),
    bench: map(src.bench),
    ir: map(src.ir),
    taxi: map(src.taxi),
  };
}

module.exports = { getRoster };
