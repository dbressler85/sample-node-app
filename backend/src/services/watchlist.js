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
const standingLib = require('../lib/standing');
const pointsMaps = require('../lib/pointsMaps');
const watchStore = require('../store/watchlist');

async function ctxFor(cookie) {
  if (config.demoMode) {
    return { week: demo.week(), statusMap: demo.playerStatus(), byeMap: demo.byes() };
  }
  const week = await nflLib.currentWeek(cookie);
  const [statusMap, byeMap] = await Promise.all([nflLib.injuryMap(cookie, week), nflLib.byeMap(cookie, week)]);
  return { week, statusMap, byeMap };
}

// My roster + free-agent set per league (the cross-league "where does he stand" data),
// plus whether the league's draft has been held (free agency isn't live until then).
async function gather(cookie, token) {
  const draftService = require('./draft'); // lazy require — draft pulls in a lot
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const data = await Promise.all(
    leagues.map(async (league) => {
      const [roster, faIds, draftOpen] = await Promise.all([
        // relationIn only needs bucket membership by id (via standing), not the enriched
        // all-franchise build — so the LIGHT my-roster read suffices, and it shares the
        // Players-screen HTTP cache key instead of triggering a separate all-franchise fetch.
        rosterService.myRosterLight(cookie, league.leagueId).catch(() => null),
        waiversService.freeAgentIds(cookie, league).catch(() => []),
        draftService.freeAgencyOpen(cookie, token, league),
      ]);
      return { league, roster, faSet: new Set(faIds), draftOpen };
    })
  );
  return data.filter((d) => d.roster);
}

// Where a watched player stands in one league — the watchlist's labels over the shared
// canonical standing: "mine" (on my roster), "rostered" (another team → trade target), or,
// when he's unrostered, "free" vs "draftable". Before a league's draft is held the whole
// pool reads as unrostered, so an unrostered watched player isn't actually claimable — he's
// "draftable" (grabbed in the draft), and only becomes a true "free" agent once the draft's
// complete and waivers open.
function relationIn(roster, faSet, id, draftOpen) {
  const s = standingLib.standing(roster, faSet, id);
  if (s.mine) return { relation: 'mine', bucket: s.bucket };
  if (s.where === 'free') return { relation: draftOpen ? 'free' : 'draftable', bucket: null };
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
    gather(cookie, token),
    (config.demoMode ? Promise.resolve(demo.news()) : newsLib.mflNews(cookie)).catch(() => []),
  ]);
  // Season-to-date points + this week's projection, under the owner's primary league's scoring —
  // the same at-a-glance numbers the other Players tabs carry.
  const points = await pointsMaps.maps(cookie, data[0] ? data[0].league : null, ctx.week);

  const newsByPlayer = new Map();
  for (const n of rawNews) {
    const pid = String(n.playerId);
    if (!newsByPlayer.has(pid)) newsByPlayer.set(pid, []);
    newsByPlayer.get(pid).push({ id: n.id, headline: n.headline, severity: n.severity, url: n.url || null });
  }

  const players = ids.map((id) => {
    const base = playersLib.resolve(byId, id);
    const leagues = data.map(({ league, roster, faSet, draftOpen }) => {
      const r = relationIn(roster, faSet, id, draftOpen);
      return { leagueId: league.leagueId, name: league.name, relation: r.relation, bucket: r.bucket };
    });
    const summary = {
      mine: leagues.filter((l) => l.relation === 'mine').length,
      free: leagues.filter((l) => l.relation === 'free').length,
      draftable: leagues.filter((l) => l.relation === 'draftable').length,
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
      seasonPoints: points.season.get(String(id)) ?? null,
      weekProjection: points.proj.get(String(id)) ?? null,
      availability: availabilityLib.resolve(base, ctx.statusMap, ctx.byeMap, ctx.week),
      news: (newsByPlayer.get(String(id)) || []).slice(0, 3),
      leagues,
      summary,
    };
  });

  // Highest value first, but surface actionable ones near the top: a claimable free agent
  // outranks a merely draftable one, which outranks players you can only trade for.
  players.sort((a, b) =>
    (b.summary.free > 0) - (a.summary.free > 0) ||
    (b.summary.draftable > 0) - (a.summary.draftable > 0) ||
    (b.value || 0) - (a.value || 0));
  return { players, totalLeagues: data.length };
}

// Watchlist alerts for Home: a watched player has become actionable in one of your
// leagues — he's a FREE AGENT you could claim, or another owner just put him ON THE
// BLOCK (their MFL trade bait). Cheap-ish: reuses the memoized free-agent id sets and
// the trade-bait board read. Returns [] fast with no watchlist.
async function alerts(cookie, token) {
  const ids = watchStore.list(token).map(String);
  if (!ids.length) return { alerts: [] };

  // Lazy require to keep the module graph acyclic (trades/draft pull in a lot).
  const tradesService = require('./trades');
  const draftService = require('./draft');
  const [leagues, byId] = await Promise.all([
    leaguesService.orderedLeagues(cookie, token),
    playersLib.load(cookie),
  ]);

  const perLeague = await Promise.all(
    leagues.map(async (league) => {
      const [open, faIds, baitMap] = await Promise.all([
        draftService.freeAgencyOpen(cookie, token, league),
        waiversService.freeAgentIds(cookie, league).catch(() => []),
        tradesService.tradeBaitByFranchise(cookie, token, league).catch(() => new Map()),
      ]);
      // Before a league has drafted, the whole player pool reads as unrostered, so a watched
      // player would falsely show as a claimable free agent — he isn't one until the draft's
      // held and waivers open. Suppress the free-agent signal for such leagues (empty FA set).
      // On-the-block still stands: a rival explicitly shopping a rostered player is a real
      // signal even in the offseason (e.g. a pending rookie draft while veteran rosters hold).
      const faSet = open ? new Set(faIds.map(String)) : new Set();
      // Players any OTHER owner is shopping (exclude my own bait).
      const rivalBait = new Set();
      for (const [fid, set] of baitMap) {
        if (String(fid) === String(league.franchiseId)) continue;
        for (const pid of set) rivalBait.add(String(pid));
      }
      const out = [];
      for (const id of ids) {
        if (faSet.has(id)) out.push({ type: 'free', playerId: id, leagueId: league.leagueId, leagueName: league.name });
        else if (rivalBait.has(id)) out.push({ type: 'onblock', playerId: id, leagueId: league.leagueId, leagueName: league.name });
      }
      return out;
    })
  );

  const alerts = perLeague.flat().map((a) => {
    const p = playersLib.resolve(byId, a.playerId);
    return { ...a, name: p.name, position: p.position, team: p.team };
  });
  // Claimable free agents first (more time-sensitive), then on-the-block.
  alerts.sort((a, b) => (a.type === 'free' ? 0 : 1) - (b.type === 'free' ? 0 : 1));
  return { alerts };
}

function add(token, playerId) {
  watchStore.add(token, playerId);
  return { ok: true, watched: true, id: String(playerId) };
}
function remove(token, playerId) {
  watchStore.remove(token, playerId);
  return { ok: true, watched: false, id: String(playerId) };
}

module.exports = { getWatchlist, alerts, add, remove };
