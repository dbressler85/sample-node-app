'use strict';

// The Player hub (M4) — the player as the primary object.
//
// Universe search + rankings, a rich per-player profile (stats, projection with
// floor/ceiling, game log, schedule difficulty, news), and — the headline —
// cross-league ownership plus player-centric add/drop across all your leagues.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const scoringLib = require('../lib/scoring');
const availabilityLib = require('../lib/availability');
const playersLib = require('../lib/players');
const nflLib = require('../lib/nfl');
const enrichmentLib = require('../lib/enrichment');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const waiversService = require('./waivers');
const dropStore = require('../store/drops');

// A neutral scoring baseline for the headline projection on a profile (each of
// your leagues can differ — those per-league numbers appear in cross-league).
const GENERIC_SCORING = { ppr: 1, tePremium: 0, passTd: 4 };

function ctxFor() {
  return {
    week: config.demoMode ? demo.week() : Number(process.env.MFL_WEEK) || null,
    statusMap: config.demoMode ? demo.playerStatus() : {},
    byeMap: config.demoMode ? demo.byes() : {},
  };
}

// Overall + positional rank by dynasty value across the whole player pool.
function computeRanks(byId, enr) {
  const arr = [...byId.values()]
    .map((p) => ({ id: p.id, position: p.position, value: enr.value(p.id) || 0 }))
    .sort((a, b) => b.value - a.value);
  const overall = new Map();
  const pos = new Map();
  const posCount = {};
  arr.forEach((p, i) => {
    overall.set(p.id, i + 1);
    posCount[p.position] = (posCount[p.position] || 0) + 1;
    pos.set(p.id, posCount[p.position]);
  });
  return { overall, pos };
}

// Gather my rosters + free-agent sets across all leagues once. Free agents come
// from MFL's freeAgents export in live (the cross-league "available where" moat).
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
  return { leagues, data: data.filter((d) => d.roster) };
}

function annotate(player, byId, ranks, myRostered, freeBy, enr) {
  const ctx = ctxFor();
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    age: enr.age(player.id),
    value: enr.value(player.id),
    posRank: ranks.pos.get(player.id) || null,
    ownership: enr.ownership(player.id),
    availability: availabilityLib.resolve(player, ctx.statusMap, ctx.byeMap, ctx.week),
    mine: myRostered.has(player.id),
    freeInLeagues: (freeBy.get(player.id) || []).length,
  };
}

async function buildSets(cookie) {
  const { data } = await gather(cookie);
  const myRostered = new Set();
  const freeBy = new Map();
  for (const d of data) {
    for (const p of [...d.roster.starters, ...d.roster.bench, ...d.roster.ir, ...d.roster.taxi]) myRostered.add(p.id);
    for (const id of d.faSet) {
      if (!freeBy.has(id)) freeBy.set(id, []);
      freeBy.get(id).push(d.league.leagueId);
    }
  }
  return { data, myRostered, freeBy };
}

async function search(cookie, token, { q, position, status } = {}) {
  const [byId, enr] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot()]);
  const ranks = computeRanks(byId, enr);
  const { myRostered, freeBy } = await buildSets(cookie);

  const term = (q || '').trim().toLowerCase();
  let players = [...byId.values()];
  if (term) players = players.filter((p) => p.name.toLowerCase().includes(term));
  if (position) players = players.filter((p) => p.position === position);

  let list = players.map((p) => annotate(p, byId, ranks, myRostered, freeBy, enr));
  if (status === 'mine') list = list.filter((p) => p.mine);
  else if (status === 'free') list = list.filter((p) => p.freeInLeagues > 0);
  else if (status === 'available') list = list.filter((p) => !p.mine);

  list.sort((a, b) => (b.value || 0) - (a.value || 0));
  return { total: list.length, players: list.slice(0, 60) };
}

async function rankings(cookie, token, { type = 'value', position } = {}) {
  const [byId, enr] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot()]);
  const ranks = computeRanks(byId, enr);
  const { myRostered, freeBy } = await buildSets(cookie);

  let list = [...byId.values()].map((p) => annotate(p, byId, ranks, myRostered, freeBy, enr));
  if (type === 'position' && position) list = list.filter((p) => p.position === position);

  // Only rank by data we actually have, so players with no signal don't float up.
  if (type === 'trending') {
    list = list.filter((p) => enr.trend(p.id) > 0).sort((a, b) => enr.trend(b.id) - enr.trend(a.id));
  } else if (type === 'rookies') {
    list = list.filter((p) => p.age != null && p.age <= 23).sort((a, b) => (b.value || 0) - (a.value || 0));
  } else {
    // value / position
    list = list.filter((p) => p.value != null).sort((a, b) => (b.value || 0) - (a.value || 0));
  }

  const note =
    list.length === 0
      ? type === 'trending'
        ? 'No trending players right now.'
        : type === 'rookies'
        ? 'No rookie/age data available right now.'
        : 'Dynasty values are unavailable right now — search and My Players still work.'
      : null;
  return { type, position: position || null, players: list.slice(0, 40), note };
}

function leagueProjection(playerId, position, leagueId) {
  if (!config.demoMode) return null;
  const stat = demo.statProjections()[playerId];
  if (!stat) return null;
  return scoringLib.projectPoints(stat, position, demo.scoring(leagueId) || {});
}

// Live per-league projected points for one player, from MFL's (format-aware)
// projectedScores for that league. Cached via the MFL client.
async function liveLeagueProjection(cookie, league, playerId) {
  try {
    const res = await mfl.exportRequest('projectedScores', { host: league.host, cookie, L: league.leagueId });
    const hit = mfl.toArray(res && res.projectedScores && res.projectedScores.playerScore)
      .find((p) => String(p.id) === String(playerId));
    return hit ? Math.round((Number(hit.score) || 0) * 10) / 10 : null;
  } catch (e) {
    return null;
  }
}

// One player's actual fantasy points for a given period (a week number, 'YTD',
// or 'AVG') under a league's scoring. MFL playerScores is league-scoped.
async function livePlayerScore(cookie, league, playerId, W) {
  try {
    const res = await mfl.exportRequest('playerScores', { host: league.host, cookie, L: league.leagueId, W, PLAYERS: playerId });
    const hit = mfl.toArray(res && res.playerScores && res.playerScores.playerScore)
      .find((p) => String(p.id) === String(playerId));
    return hit && hit.score !== '' && hit.score != null ? Math.round((Number(hit.score) || 0) * 10) / 10 : null;
  } catch (e) {
    return null;
  }
}

// Live season line + recent game log for a player, scored under one of the
// owner's leagues. Season totals come from YTD + AVG (2 calls) so we don't loop
// every week; the game log fetches only the last few completed weeks.
async function liveSeasonAndLog(cookie, league, playerId, week) {
  if (!league) return { season: null, log: [] };
  const [ytd, avg] = await Promise.all([
    livePlayerScore(cookie, league, playerId, 'YTD'),
    livePlayerScore(cookie, league, playerId, 'AVG'),
  ]);
  let season = null;
  if (ytd != null && ytd > 0) {
    const games = avg && avg > 0 ? Math.max(1, Math.round(ytd / avg)) : null;
    season = { points: ytd, games, ppg: avg != null ? avg : games ? Math.round((ytd / games) * 10) / 10 : null };
  }
  const log = [];
  if (week && week > 1) {
    const weeks = [];
    for (let w = Math.max(1, week - 4); w < week; w++) weeks.push(w);
    const pts = await Promise.all(weeks.map((w) => livePlayerScore(cookie, league, playerId, w)));
    weeks.forEach((w, i) => {
      if (pts[i] != null) log.push({ week: w, pts: pts[i], line: null });
    });
  }
  return { season, log };
}

async function profile(cookie, token, playerId) {
  const [byId, enr] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot()]);
  const base = playersLib.resolve(byId, playerId);
  const ranks = computeRanks(byId, enr);
  const ctx = ctxFor();
  // Live bye weeks (so availability + the profile's byeWeek are real).
  const byeMap = config.demoMode ? demo.byes() : await nflLib.byeMap(cookie, ctx.week);

  // Game log + season. Demo has a fixture; live pulls actual points from MFL
  // playerScores, scored under the owner's first league.
  let log;
  let season;
  if (config.demoMode) {
    log = demo.gameLog(playerId);
    const seasonPoints = Math.round(log.reduce((s, g) => s + g.pts, 0) * 10) / 10;
    season = log.length ? { points: seasonPoints, games: log.length, ppg: Math.round((seasonPoints / log.length) * 10) / 10 } : null;
  } else {
    const leagues = await leaguesService.listLeagues(cookie);
    const res = await liveSeasonAndLog(cookie, leagues[0], playerId, ctx.week);
    log = res.log;
    season = res.season;
  }

  // Upcoming schedule difficulty.
  const upcoming = config.demoMode ? demo.schedule(base.team) : [];
  const avgDifficulty = upcoming.length ? Math.round((upcoming.reduce((s, g) => s + g.difficulty, 0) / upcoming.length) * 10) / 10 : null;

  // News about this player.
  const news = (config.demoMode ? demo.news() : []).filter((n) => String(n.playerId) === String(playerId)).map((n) => ({ id: n.id, headline: n.headline, severity: n.severity }));

  // Cross-league ownership + per-league projection.
  const { data } = await gather(cookie);
  const crossLeague = await Promise.all(
    data.map(async ({ league, roster, faSet }) => {
      let relation = 'unavailable';
      let bucket = null;
      if (dropStore.has(token, league.leagueId, playerId)) relation = 'dropped';
      else if (roster.starters.some((p) => p.id === playerId)) { relation = 'rostered'; bucket = 'starter'; }
      else if (roster.bench.some((p) => p.id === playerId)) { relation = 'rostered'; bucket = 'bench'; }
      else if (roster.ir.some((p) => p.id === playerId)) { relation = 'rostered'; bucket = 'ir'; }
      else if (roster.taxi.some((p) => p.id === playerId)) { relation = 'rostered'; bucket = 'taxi'; }
      else if (faSet.has(playerId)) relation = 'free';
      const proj = config.demoMode
        ? leagueProjection(playerId, base.position, league.leagueId)
        : await liveLeagueProjection(cookie, league, playerId);
      return {
        leagueId: league.leagueId,
        name: league.name,
        relation,
        bucket,
        system: config.demoMode ? (demo.waiverSettings(league.leagueId) || {}).system : null,
        leagueProjection: proj,
      };
    })
  );

  // Headline outlook: demo uses a neutral baseline off raw stats; live has no raw
  // stats, so use the best per-league projected points we found as the median.
  let median = null;
  if (config.demoMode) {
    const stat = demo.statProjections()[playerId];
    median = stat ? scoringLib.projectPoints(stat, base.position, GENERIC_SCORING) : null;
  } else {
    const projs = crossLeague.map((c) => c.leagueProjection).filter((n) => n != null);
    median = projs.length ? Math.max(...projs) : null;
  }
  const outlook = median != null ? scoringLib.band(median, base.position) : null;

  return {
    id: base.id,
    name: base.name,
    position: base.position,
    team: base.team,
    age: enr.age(playerId),
    byeWeek: byeMap[base.team] || null,
    value: enr.value(playerId),
    overallRank: ranks.overall.get(playerId) || null,
    posRank: ranks.pos.get(playerId) || null,
    ownership: enr.ownership(playerId),
    trend: enr.trend(playerId),
    availability: availabilityLib.resolve(base, ctx.statusMap, byeMap, ctx.week),
    outlook,
    season,
    gameLog: log,
    schedule: { upcoming, avgDifficulty },
    news,
    crossLeague,
    actions: {
      addLeagues: crossLeague.filter((c) => c.relation === 'free').map((c) => ({ leagueId: c.leagueId, name: c.name, system: c.system })),
      dropLeagues: crossLeague.filter((c) => c.relation === 'rostered').map((c) => ({ leagueId: c.leagueId, name: c.name, bucket: c.bucket })),
    },
  };
}

// Preview a cross-league add: one claim preview per league where he's free.
async function previewAdd(cookie, token, playerId) {
  const p = await profile(cookie, token, playerId);
  const leagues = await Promise.all(
    p.actions.addLeagues.map(async (l) => {
      const pv = await waiversService.preview(cookie, token, l.leagueId, { addId: playerId });
      return {
        leagueId: l.leagueId,
        name: l.name,
        system: pv.system,
        suggestedDrop: pv.suggestedDrop,
        drop: pv.drop,
        dropRequired: pv.dropRequired,
        suggestedBid: pv.suggestedBid,
        bid: pv.bid,
        budgetAfter: pv.budgetAfter,
        clearTime: pv.clearTime,
        valid: pv.valid,
        errors: pv.errors,
      };
    })
  );
  return { player: { id: p.id, name: p.name, position: p.position, team: p.team, value: p.value }, leagues };
}

// Submit the add across the chosen leagues (each with optional drop/bid override).
async function submitAdd(cookie, token, playerId, selections) {
  const results = await Promise.all(
    (selections || []).map(async (s) => {
      try {
        const res = await waiversService.submit(cookie, token, s.leagueId, { addId: playerId, dropId: s.dropId, bid: s.bid });
        return { leagueId: s.leagueId, ok: true, claim: res.submitted };
      } catch (e) {
        return { leagueId: s.leagueId, ok: false, error: e.message };
      }
    })
  );
  return { results, summary: { requested: results.length, submitted: results.filter((r) => r.ok).length } };
}

// Drop a player across the chosen leagues (must be rostered there).
async function submitDrop(cookie, token, playerId, leagueIds) {
  const { data } = await gather(cookie);
  const owns = new Map(data.map((d) => [d.league.leagueId, d]));
  const results = await Promise.all(
    (leagueIds || []).map(async (leagueId) => {
      const d = owns.get(String(leagueId));
      const rostered = d && [...d.roster.starters, ...d.roster.bench, ...d.roster.ir, ...d.roster.taxi].some((p) => p.id === playerId);
      if (!rostered) return { leagueId, ok: false, error: 'Not on your roster in this league.' };
      try {
        if (!config.demoMode) {
          await mfl.importRequest('drop', { host: d.league.host, cookie, L: leagueId, FRANCHISE: d.league.franchiseId, DROP: playerId });
        }
        dropStore.set(token, leagueId, playerId);
        return { leagueId, ok: true };
      } catch (e) {
        return { leagueId, ok: false, error: e.message };
      }
    })
  );
  return { results, summary: { requested: results.length, dropped: results.filter((r) => r.ok).length } };
}

module.exports = { search, rankings, profile, previewAdd, submitAdd, submitDrop };
