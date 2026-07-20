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
const newsLib = require('../lib/news');
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');
const standingLib = require('../lib/standing');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const waiversService = require('./waivers');
const dropStore = require('../store/drops');
const watchStore = require('../store/watchlist');
const playerTags = require('../store/playerTags');
const { createMemo } = require('../lib/memo');

// A neutral scoring baseline for the headline projection on a profile (each of
// your leagues can differ — those per-league numbers appear in cross-league).
const GENERIC_SCORING = { ppr: 1, tePremium: 0, passTd: 4 };

// Availability context (current week + injury/bye maps). Live now really fetches
// these from MFL so search / rankings / profiles badge OUT/injured/bye players
// instead of showing everyone as ACTIVE.
async function ctxFor(cookie) {
  if (config.demoMode) {
    return { week: demo.week(), statusMap: demo.playerStatus(), byeMap: demo.byes() };
  }
  const week = await nflLib.currentWeek(cookie);
  const [statusMap, byeMap] = await Promise.all([nflLib.injuryMap(cookie, week), nflLib.byeMap(cookie, week)]);
  return { week, statusMap, byeMap };
}

// Overall + positional rank by dynasty value across the whole player pool. This
// sorts the entire player universe (thousands) and is called by search, rankings,
// AND profile (which only needs two scalars from it). Cache it against the
// enrichment snapshot object's identity: the neutral snapshot is memoized per
// cookie for its TTL, so ranks rebuild exactly when values refresh and are shared
// across all three endpoints in between, instead of re-sorting on every request.
const ranksCache = new WeakMap(); // enr snapshot -> { overall, pos }
function computeRanks(byId, enr) {
  const cached = ranksCache.get(enr);
  if (cached) return cached;
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
  const result = { overall, pos };
  ranksCache.set(enr, result);
  return result;
}

// Gather my rosters + free-agent sets across all leagues once. Free agents come
// from MFL's freeAgents export in live (the cross-league "available where" moat).
// This per-league fan-out (a full roster build + free-agent read for EVERY league) is
// the dominant cost of the Players screen, and search / rankings / profile each call it.
// Memoize the assembled result per cookie so switching rank type, refining a search, or
// opening a profile in quick succession share ONE gather (and concurrent calls coalesce)
// instead of re-fanning-out every time. Roster/waiver writes invalidate it; the short TTL
// bounds staleness of the "mine / free" badges to seconds otherwise.
const gatherMemo = createMemo({ ttlMs: config.mflCacheTtlMs });

async function gatherUncached(cookie) {
  const leagues = await leaguesService.listLeagues(cookie);
  const data = await Promise.all(
    leagues.map(async (league) => {
      // A LIGHT roster read — just my player ids by bucket. gather's consumers only test
      // which bucket a player is in; they never touch value/age/strength, so the full
      // (all-franchise, enriched, strength-scored) getRoster build would be wasted here.
      const [roster, faIds] = await Promise.all([
        rosterService.myRosterLight(cookie, league.leagueId).catch(() => null),
        waiversService.freeAgentIds(cookie, league).catch(() => []),
      ]);
      return { league, roster, faSet: new Set(faIds) };
    })
  );
  return { leagues, data: data.filter((d) => d.roster) };
}

function gather(cookie) {
  return gatherMemo.get(cookie || '', () => gatherUncached(cookie));
}

// Drop the cross-league sets after a write that changes a roster / free-agent pool, so the
// next Players read reflects it immediately instead of waiting out the TTL.
function invalidateGather(cookie) {
  gatherMemo.invalidate(cookie || '');
}

function annotate(player, byId, ranks, myRostered, freeBy, enr, ctx) {
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
  const [byId, enr, ctx] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(undefined, cookie), ctxFor(cookie)]);
  const ranks = computeRanks(byId, enr);
  const { myRostered, freeBy } = await buildSets(cookie);

  const term = (q || '').trim().toLowerCase();
  let players = [...byId.values()];
  if (term) players = players.filter((p) => p.name.toLowerCase().includes(term));
  if (position) players = players.filter((p) => p.position === position);

  // Filter + sort on cheap lookups first; run the expensive annotate (availability
  // resolution) only on the page we actually return, not the whole universe.
  let light = players.map((p) => ({ p, value: enr.value(p.id) || 0, mine: myRostered.has(p.id), free: (freeBy.get(p.id) || []).length }));
  if (status === 'mine') light = light.filter((x) => x.mine);
  else if (status === 'free') light = light.filter((x) => x.free > 0);
  else if (status === 'available') light = light.filter((x) => !x.mine);

  light.sort((a, b) => b.value - a.value);
  const players2 = light.slice(0, 60).map((x) => annotate(x.p, byId, ranks, myRostered, freeBy, enr, ctx));
  return { total: light.length, players: players2 };
}

async function rankings(cookie, token, { type = 'value', position } = {}) {
  const [byId, enr, ctx] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(undefined, cookie), ctxFor(cookie)]);
  const ranks = computeRanks(byId, enr);
  const { myRostered, freeBy } = await buildSets(cookie);

  // Filter + sort on cheap enr lookups over lightweight rows, then annotate only
  // the top slice — availability resolution over the whole universe just to
  // discard 99% of it was the cost here.
  const tags = playerTags.all(token);
  let cand = [...byId.values()];
  if (type === 'position' && position) cand = cand.filter((p) => p.position === position);
  let light = cand.map((p) => ({ p, value: enr.value(p.id), age: enr.age(p.id), trend: enr.trend(p.id) }));

  // Only rank by data we actually have, so players with no signal don't float up.
  if (type === 'trending') {
    light = light.filter((x) => x.trend > 0).sort((a, b) => b.trend - a.trend);
  } else if (type === 'rookies') {
    light = light.filter((x) => x.age != null && x.age <= 23).sort((a, b) => (b.value || 0) - (a.value || 0));
  } else if (type === 'myvalue') {
    // Your personal ranking: market value × your Target/Avoid modifier, so your Targets
    // rise and your Avoids fall. (Displayed value stays the honest market value.)
    const pv = (x) => (x.value || 0) * playerTags.modifier(tags[String(x.p.id)]);
    light = light.filter((x) => x.value != null).sort((a, b) => pv(b) - pv(a));
  } else {
    // value / position
    light = light.filter((x) => x.value != null).sort((a, b) => (b.value || 0) - (a.value || 0));
  }

  const list = light.slice(0, 40).map((x) => {
    const row = annotate(x.p, byId, ranks, myRostered, freeBy, enr, ctx);
    row.tag = tags[String(row.id)] || null;
    return row;
  });

  const note =
    list.length === 0
      ? type === 'trending'
        ? 'No trending players right now.'
        : type === 'rookies'
        ? 'No rookie/age data available right now.'
        : 'Dynasty values are unavailable right now — search and My Players still work.'
      : null;
  return { type, position: position || null, players: list, note };
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
  const [byId, enr] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(undefined, cookie)]);
  const base = playersLib.resolve(byId, playerId);
  const ranks = computeRanks(byId, enr);
  const ctx = await ctxFor(cookie);
  // ctx already carries the (live-fetched) bye map, so availability + the
  // profile's byeWeek are real.
  const byeMap = ctx.byeMap;

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

  // Upcoming schedule. Demo has difficulty ratings; live surfaces the real
  // opponents from the NFL schedule (difficulty null — no strength-of-schedule
  // source wired in live yet), so avgDifficulty is only computed when every
  // game carries a rating.
  const upcoming = config.demoMode ? demo.schedule(base.team) : await nflLib.upcomingOpponents(cookie, base.team, ctx.week);
  const rated = upcoming.filter((g) => g.difficulty != null);
  const avgDifficulty = rated.length === upcoming.length && upcoming.length
    ? Math.round((upcoming.reduce((s, g) => s + g.difficulty, 0) / upcoming.length) * 10) / 10
    : null;

  // News about this player (demo fixture, or ESPN mapped to MFL players in live).
  const rawNews = config.demoMode ? demo.news() : await newsLib.mflNews(cookie);
  const news = rawNews
    .filter((n) => String(n.playerId) === String(playerId))
    .map((n) => ({ id: n.id, headline: n.headline, severity: n.severity, url: n.url || null }));

  // Cross-league ownership + per-league projection.
  const { data } = await gather(cookie);
  const crossLeague = await Promise.all(
    data.map(async ({ league, roster, faSet }) => {
      // The profile's labels over the shared canonical standing: a player I've dropped
      // here, "rostered" (on MY roster, with the slot), "free", or "unavailable" (owned
      // by another team). Same classification the watchlist uses, different vocabulary.
      let relation = 'unavailable';
      let bucket = null;
      if (dropStore.has(token, league.leagueId, playerId)) {
        relation = 'dropped';
      } else {
        const s = standingLib.standing(roster, faSet, playerId);
        if (s.mine) { relation = 'rostered'; bucket = s.bucket; }
        else if (s.where === 'free') relation = 'free';
      }
      const proj = config.demoMode
        ? leagueProjection(playerId, base.position, league.leagueId)
        : await liveLeagueProjection(cookie, league, playerId);
      // Format-aware dynasty value for THIS league — a superflex QB is worth far
      // more here than in a 1QB league, so the value differs per format. Snapshots
      // cache per format, so repeated formats across leagues are cheap.
      const fmt = await leagueFormat.format(cookie, league);
      const enrL = await enrichmentLib.snapshot(fmt, cookie);
      return {
        leagueId: league.leagueId,
        name: league.name,
        relation,
        bucket,
        system: config.demoMode ? (demo.waiverSettings(league.leagueId) || {}).system : null,
        leagueProjection: proj,
        value: enrL.value(playerId),
        format: leagueFormat.label(fmt),
      };
    })
  );
  // The player's value spread across your league formats (the "compare across my
  // leagues" signal). Same everywhere in a single-format portfolio; wider in a mix.
  const leagueValues = crossLeague.map((c) => c.value).filter((v) => v != null);
  const valueRange = leagueValues.length ? { min: Math.min(...leagueValues), max: Math.max(...leagueValues) } : null;

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
    valueRange,
    overallRank: ranks.overall.get(playerId) || null,
    posRank: ranks.pos.get(playerId) || null,
    ownership: enr.ownership(playerId),
    trend: enr.trend(playerId),
    watched: watchStore.has(token, playerId),
    tag: playerTags.get(token, playerId), // 'target' | 'avoid' | null
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
  if (results.some((r) => r.ok)) invalidateGather(cookie); // a claim can change rosters/FAs
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
          // Roster shrank and the player is now a free agent — refresh both reads.
          waiversService.invalidate(cookie, leagueId);
        }
        dropStore.set(token, leagueId, playerId);
        return { leagueId, ok: true };
      } catch (e) {
        return { leagueId, ok: false, error: e.message };
      }
    })
  );
  if (results.some((r) => r.ok)) invalidateGather(cookie); // roster shrank / player now free
  return { results, summary: { requested: results.length, dropped: results.filter((r) => r.ok).length } };
}

module.exports = { search, rankings, profile, previewAdd, submitAdd, submitDrop };
