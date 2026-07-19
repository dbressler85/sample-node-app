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

function dyn(id) {
  return config.demoMode ? demo.dynasty(id) : null;
}

// Overall + positional rank by dynasty value across the whole player pool.
function computeRanks(byId) {
  const arr = [...byId.values()]
    .map((p) => ({ id: p.id, position: p.position, value: (dyn(p.id) || {}).value || 0 }))
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

// Gather my rosters + free-agent sets across all leagues once.
async function gather(cookie) {
  const leagues = await leaguesService.listLeagues(cookie);
  const data = await Promise.all(
    leagues.map(async (league) => {
      const roster = await rosterService.getRoster(cookie, league.leagueId).catch(() => null);
      return { league, roster, faSet: new Set(config.demoMode ? demo.freeAgents(league.leagueId) : []) };
    })
  );
  return { leagues, data: data.filter((d) => d.roster) };
}

function annotate(player, byId, ranks, myRostered, freeBy) {
  const d = dyn(player.id) || {};
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    team: player.team,
    age: d.age != null ? d.age : null,
    value: d.value != null ? d.value : null,
    posRank: ranks.pos.get(player.id) || null,
    ownership: config.demoMode ? demo.ownership(player.id) : null,
    availability: availabilityLib.resolve(player, ctxFor().statusMap, ctxFor().byeMap, ctxFor().week),
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
  const byId = await playersLib.load(cookie);
  const ranks = computeRanks(byId);
  const { myRostered, freeBy } = await buildSets(cookie);

  const term = (q || '').trim().toLowerCase();
  let players = [...byId.values()];
  if (term) players = players.filter((p) => p.name.toLowerCase().includes(term));
  if (position) players = players.filter((p) => p.position === position);

  let list = players.map((p) => annotate(p, byId, ranks, myRostered, freeBy));
  if (status === 'mine') list = list.filter((p) => p.mine);
  else if (status === 'free') list = list.filter((p) => p.freeInLeagues > 0);
  else if (status === 'available') list = list.filter((p) => !p.mine);

  list.sort((a, b) => (b.value || 0) - (a.value || 0));
  return { total: list.length, players: list.slice(0, 60) };
}

async function rankings(cookie, token, { type = 'value', position } = {}) {
  const byId = await playersLib.load(cookie);
  const ranks = computeRanks(byId);
  const { myRostered, freeBy } = await buildSets(cookie);

  let list = [...byId.values()].map((p) => annotate(p, byId, ranks, myRostered, freeBy));
  if (type === 'position' && position) list = list.filter((p) => p.position === position);

  // Only rank by data we actually have — otherwise team defenses float to the top
  // of a value ranking with no values. Live has none of these sources yet.
  if (type === 'trending') {
    list.sort((a, b) => (config.demoMode ? demo.trend(b.id) - demo.trend(a.id) : 0));
    list = list.filter((p) => (config.demoMode ? demo.trend(p.id) : 0) > 0);
  } else if (type === 'rookies') {
    list = list.filter((p) => p.age != null && p.age <= 23).sort((a, b) => (b.value || 0) - (a.value || 0));
  } else {
    // value / position
    list = list.filter((p) => p.value != null).sort((a, b) => (b.value || 0) - (a.value || 0));
  }

  const note =
    list.length === 0 && !config.demoMode
      ? type === 'trending'
        ? 'Waiver-trend data isn’t wired for live leagues yet.'
        : type === 'rookies'
        ? 'Age/rookie data isn’t wired for live leagues yet.'
        : 'Dynasty values aren’t wired for live leagues yet — search or My Players still work.'
      : null;
  return { type, position: position || null, players: list.slice(0, 40), note };
}

function leagueProjection(playerId, position, leagueId) {
  if (!config.demoMode) return null;
  const stat = demo.statProjections()[playerId];
  if (!stat) return null;
  return scoringLib.projectPoints(stat, position, demo.scoring(leagueId) || {});
}

async function profile(cookie, token, playerId) {
  const byId = await playersLib.load(cookie);
  const base = playersLib.resolve(byId, playerId);
  const ranks = computeRanks(byId);
  const ctx = ctxFor();
  const d = dyn(playerId) || {};

  // Headline outlook (neutral PPR baseline) with floor/ceiling.
  const stat = config.demoMode ? demo.statProjections()[playerId] : null;
  const median = stat ? scoringLib.projectPoints(stat, base.position, GENERIC_SCORING) : null;
  const outlook = median != null ? scoringLib.band(median, base.position) : null;

  // Game log + season.
  const log = config.demoMode ? demo.gameLog(playerId) : [];
  const seasonPoints = Math.round(log.reduce((s, g) => s + g.pts, 0) * 10) / 10;
  const season = log.length ? { points: seasonPoints, games: log.length, ppg: Math.round((seasonPoints / log.length) * 10) / 10 } : null;

  // Upcoming schedule difficulty.
  const upcoming = config.demoMode ? demo.schedule(base.team) : [];
  const avgDifficulty = upcoming.length ? Math.round((upcoming.reduce((s, g) => s + g.difficulty, 0) / upcoming.length) * 10) / 10 : null;

  // News about this player.
  const news = (config.demoMode ? demo.news() : []).filter((n) => String(n.playerId) === String(playerId)).map((n) => ({ id: n.id, headline: n.headline, severity: n.severity }));

  // Cross-league ownership.
  const { data } = await gather(cookie);
  const crossLeague = data.map(({ league, roster, faSet }) => {
    let relation = 'unavailable';
    let bucket = null;
    if (dropStore.has(token, league.leagueId, playerId)) relation = 'dropped';
    else if (roster.starters.some((p) => p.id === playerId)) { relation = 'rostered'; bucket = 'starter'; }
    else if (roster.bench.some((p) => p.id === playerId)) { relation = 'rostered'; bucket = 'bench'; }
    else if (roster.ir.some((p) => p.id === playerId)) { relation = 'rostered'; bucket = 'ir'; }
    else if (roster.taxi.some((p) => p.id === playerId)) { relation = 'rostered'; bucket = 'taxi'; }
    else if (faSet.has(playerId)) relation = 'free';
    return {
      leagueId: league.leagueId,
      name: league.name,
      relation,
      bucket,
      system: config.demoMode ? (demo.waiverSettings(league.leagueId) || {}).system : null,
      leagueProjection: leagueProjection(playerId, base.position, league.leagueId),
    };
  });

  return {
    id: base.id,
    name: base.name,
    position: base.position,
    team: base.team,
    age: d.age != null ? d.age : null,
    byeWeek: config.demoMode ? demo.byes()[base.team] || null : null,
    value: d.value != null ? d.value : null,
    overallRank: ranks.overall.get(playerId) || null,
    posRank: ranks.pos.get(playerId) || null,
    ownership: config.demoMode ? demo.ownership(playerId) : null,
    trend: config.demoMode ? demo.trend(playerId) : 0,
    availability: availabilityLib.resolve(base, ctx.statusMap, ctx.byeMap, ctx.week),
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
