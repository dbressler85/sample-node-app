'use strict';

// Cross-league watchlist. Star a player once and see, in one list, his dynasty
// value / age / trend / availability / news, plus where he stands in EVERY one of
// your leagues: on your roster, a free agent you could add, or on another team
// (a trade target). Reuses the same per-league roster + free-agent sets the player
// hub builds, so the roll-up is cheap and consistent with the profile.

const config = require('../config');
const playersLib = require('../lib/players');
const enrichmentLib = require('../lib/enrichment');
const availabilityLib = require('../lib/availability');
const nflLib = require('../lib/nfl');
const newsLib = require('../lib/news');
const demo = require('../demo/fixtures');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const waiversService = require('./waivers');
const watchStore = require('../store/watchlist');

async function ctxFor(cookie) {
  if (config.demoMode) {
    return { week: demo.week(), statusMap: demo.playerStatus(), byeMap: demo.byes() };
  }
  const week = await nflLib.currentWeek(cookie);
  const [statusMap, byeMap] = await Promise.all([nflLib.injuryMap(cookie, week), nflLib.byeMap(cookie, week)]);
  return { week, statusMap, byeMap };
}

// My roster + free-agent set per league (the cross-league "where does he stand" data).
async function gather(cookie) {
  const leagues = await leaguesService.listLeagues(cookie);
  const data = await Promise.all(
    leagues.map(async (league) => {
      const [roster, faIds] = await Promise.all([
        rosterService.getRoster(cookie, league.leagueId).catch(() => null),
        waiversService.freeAgentIds(cookie, league).catch(() => []),
      ]);
      return { league, roster, faSet: new Set(faIds) };
    })
  );
  return data.filter((d) => d.roster);
}

// Where a watched player stands in one league.
function relationIn(roster, faSet, id) {
  if (roster.starters.some((p) => p.id === id)) return { relation: 'mine', bucket: 'starter' };
  if (roster.bench.some((p) => p.id === id)) return { relation: 'mine', bucket: 'bench' };
  if (roster.ir.some((p) => p.id === id)) return { relation: 'mine', bucket: 'ir' };
  if (roster.taxi.some((p) => p.id === id)) return { relation: 'mine', bucket: 'taxi' };
  if (faSet.has(id)) return { relation: 'free', bucket: null };
  return { relation: 'rostered', bucket: null }; // on another team → trade target
}

async function getWatchlist(cookie, token) {
  const ids = watchStore.list(token);
  if (!ids.length) return { players: [], totalLeagues: 0 };

  const [byId, enr, ctx] = await Promise.all([
    playersLib.load(cookie),
    enrichmentLib.snapshot(undefined, cookie),
    ctxFor(cookie),
  ]);
  const [data, rawNews] = await Promise.all([
    gather(cookie),
    (config.demoMode ? Promise.resolve(demo.news()) : newsLib.mflNews(cookie)).catch(() => []),
  ]);

  const newsByPlayer = new Map();
  for (const n of rawNews) {
    const pid = String(n.playerId);
    if (!newsByPlayer.has(pid)) newsByPlayer.set(pid, []);
    newsByPlayer.get(pid).push({ id: n.id, headline: n.headline, severity: n.severity, url: n.url || null });
  }

  const players = ids.map((id) => {
    const base = playersLib.resolve(byId, id);
    const leagues = data.map(({ league, roster, faSet }) => {
      const r = relationIn(roster, faSet, id);
      return { leagueId: league.leagueId, name: league.name, relation: r.relation, bucket: r.bucket };
    });
    const summary = {
      mine: leagues.filter((l) => l.relation === 'mine').length,
      free: leagues.filter((l) => l.relation === 'free').length,
      tradeTarget: leagues.filter((l) => l.relation === 'rostered').length,
    };
    return {
      id: base.id,
      name: base.name,
      position: base.position,
      team: base.team,
      value: enr.value(id),
      age: enr.age(id),
      trend: enr.trend(id),
      ownership: enr.ownership(id),
      availability: availabilityLib.resolve(base, ctx.statusMap, ctx.byeMap, ctx.week),
      news: (newsByPlayer.get(String(id)) || []).slice(0, 3),
      leagues,
      summary,
    };
  });

  // Highest value first, but surface actionable ones (free somewhere) near the top.
  players.sort((a, b) => (b.summary.free > 0) - (a.summary.free > 0) || (b.value || 0) - (a.value || 0));
  return { players, totalLeagues: data.length };
}

function add(token, playerId) {
  watchStore.add(token, playerId);
  return { ok: true, watched: true, id: String(playerId) };
}
function remove(token, playerId) {
  watchStore.remove(token, playerId);
  return { ok: true, watched: false, id: String(playerId) };
}

module.exports = { getWatchlist, add, remove };
