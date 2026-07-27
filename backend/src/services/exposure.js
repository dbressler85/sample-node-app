'use strict';

// Cross-league player exposure — the moat feature. See every league you roster a
// given player in, whether you're starting him, and his status/value, all at once.
// When news breaks, you know instantly which of your teams it touches.

const config = require('../config');
const demo = require('../demo/fixtures');
const newsLib = require('../lib/news');
const nflLib = require('../lib/nfl');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const { mapLeagues } = require('../lib/safe');
const { withRetry } = require('../lib/retry');
const standingLib = require('../lib/standing');
const pointsMaps = require('../lib/pointsMaps');
const playerTags = require('../store/playerTags');
const watchStore = require('../store/watchlist');
const playersLib = require('../lib/players');
const availabilityLib = require('../lib/availability');
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');

// Current NFL week (demo fixture or live), for the season/projection numbers below.
async function currentWeek(cookie) {
  return config.demoMode ? demo.week() : nflLib.currentWeek(cookie);
}

async function gather(cookie, token) {
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const rosters = (
    await mapLeagues(
      leagues,
      // Exposure only needs MY valued players by bucket, not the all-franchise strength build —
      // the light enriched read skips the rival fetch + strength/picks/summary. Retry a transient
      // throttle before dropping the league — a dropped roster silently removes it from every
      // exposure count (the "owned in 8/8 when I'm in 15" bug applied to My Players).
      (l) => withRetry(() => rosterService.myRosterEnriched(cookie, l.leagueId)).then((roster) => (roster ? { league: l, roster } : null)),
      null,
      'exposure.roster'
    )
  ).filter(Boolean);
  return { totalLeagues: leagues.length, rosters };
}

async function getExposure(cookie, token) {
  const { totalLeagues, rosters } = await gather(cookie, token);
  // Exposure counts (and the % below) are over the leagues we could actually read. When a throttle
  // drops one, we say so via partial/leaguesLoaded instead of silently deflating every player's
  // exposure against the full total — the "N of 15 leagues loaded" honesty contract.
  const leaguesLoaded = rosters.length;
  const partial = leaguesLoaded < totalLeagues;
  const denom = leaguesLoaded || totalLeagues;
  // Season-to-date points + this week's projection, under the owner's primary league's scoring —
  // surfaced on every My Players row (same numbers the rest of the Players screen shows).
  const league0 = rosters[0] ? rosters[0].league : null;
  const points = await pointsMaps.maps(cookie, league0, await currentWeek(cookie));
  const map = new Map(); // playerId -> aggregate record

  for (const { league, roster } of rosters) {
    // Iterate each bucket with its label so we know a player's bucket directly, instead
    // of re-scanning all four arrays per player (was O(rosterSize^2)). Bucket names come
    // from the shared standing definition so exposure and the profile/watchlist agree.
    for (const [key, bucket] of standingLib.BUCKETS) {
      const list = roster[key] || [];
      for (const p of list) {
        if (!map.has(p.id)) {
          map.set(p.id, {
            id: p.id,
            name: p.name,
            position: p.position,
            team: p.team,
            age: p.age,
            value: p.value,
            availability: p.availability,
            leagues: [],
          });
        }
        map.get(p.id).leagues.push({
          leagueId: league.leagueId,
          name: league.name,
          starting: bucket === 'starter',
          bucket,
        });
      }
    }
  }

  const tags = playerTags.all(token);
  const watchSet = new Set(watchStore.list(token).map(String));
  const players = [...map.values()]
    .map((p) => ({
      ...p,
      count: p.leagues.length,
      startingCount: p.leagues.filter((l) => l.starting).length,
      exposurePct: denom ? Math.round((p.leagues.length / denom) * 100) : 0,
      seasonPoints: points.season.get(String(p.id)) ?? null,
      weekProjection: points.proj.get(String(p.id)) ?? null,
      tag: tags[String(p.id)] || null,
      watched: watchSet.has(String(p.id)),
    }))
    .sort((a, b) => b.count - a.count || (b.value || 0) - (a.value || 0));

  return {
    totalLeagues,
    // Honesty flags: counts above are over leaguesLoaded of leaguesTotal. When partial, the app shows
    // "N of {leaguesTotal} leagues loaded" instead of presenting the exposure map as complete.
    leaguesTotal: totalLeagues,
    leaguesLoaded,
    partial,
    players,
    summary: {
      uniquePlayers: players.length,
      // Players you roster in more than one league — your concentration.
      multiLeague: players.filter((p) => p.count > 1).length,
    },
  };
}

// The per-player enrichment the exposure feed layers onto a set of rostered ids — the GLOBAL/backend
// half of a DEVICE-ORIGIN exposure read (docs/DEVICE_ORIGIN_MFL.md). The device fetches MY roster in
// every league straight from MFL (its own IP — the fan-out that trips the shared limiter), sends the
// union of ids here, and assembles the cross-league grouping on-device with the shared assembleExposure.
// This serves exactly the fields that loop attaches: name/pos/team/age/value/availability, plus this
// league's season/projection points, the personal tag, and the watched flag. `primaryLeagueId` selects
// the scoring/value FORMAT — matching getExposure, which prices every row against the owner's primary
// league. Auth-gated; a subset (only the requested ids). Fail-soft, never throws for a bad id.
async function enrichForExposure(cookie, token, ids, primaryLeagueId) {
  const wanted = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))].slice(0, 4000);
  const leagues = await leaguesService.listLeagues(cookie).catch(() => []);
  const league = leagues.find((l) => l.leagueId === String(primaryLeagueId)) || leagues[0] || null;
  const week = await currentWeek(cookie);
  const [byId, statusMap, byeMap, enr, points] = await Promise.all([
    playersLib.load(cookie),
    config.demoMode ? Promise.resolve(demo.playerStatus()) : nflLib.injuryMap(cookie, week),
    config.demoMode ? Promise.resolve(demo.byes()) : nflLib.byeMap(cookie, week),
    (league ? leagueFormat.format(cookie, league) : Promise.resolve(null)).then((fmt) => enrichmentLib.snapshot(fmt, cookie)),
    pointsMaps.maps(cookie, league, week),
  ]);
  const tags = playerTags.all(token);
  const watchSet = new Set(watchStore.list(token).map(String));
  const players = {};
  for (const id of wanted) {
    const b = playersLib.resolve(byId, id);
    players[id] = {
      name: b.name,
      position: b.position,
      team: b.team,
      age: enr.age(id),
      value: enr.value(id),
      availability: availabilityLib.resolve(b, statusMap, byeMap, week),
      seasonPoints: points.season.get(String(id)) ?? null,
      weekProjection: points.proj.get(String(id)) ?? null,
      tag: tags[String(id)] || null,
      watched: watchSet.has(String(id)),
    };
  }
  return { players };
}

// News mapped to impact: which of your teams each item affects, and where you're
// starting the player. One glance instead of eight message boards.
async function getNews(cookie, token) {
  const exposure = await getExposure(cookie, token);
  const byPlayer = new Map(exposure.players.map((p) => [p.id, p]));
  // Demo has a fixture; live pulls ESPN news mapped to MFL players by name.
  const items = config.demoMode ? demo.news() : await newsLib.mflNews(cookie);

  let news = items.map((n) => {
    const p = byPlayer.get(String(n.playerId));
    const affected = p ? p.leagues : [];
    return {
      id: n.id,
      headline: n.headline,
      severity: n.severity,
      url: n.url || null,
      published: n.published || null,
      player: p
        ? { id: p.id, name: p.name, position: p.position, team: p.team, availability: p.availability }
        : { id: String(n.playerId) },
      affectedLeagues: affected,
      affectedCount: affected.length,
      startingCount: affected.filter((l) => l.starting).length,
    };
  });

  const rank = { high: 3, medium: 2, low: 1 };

  // Collapse duplicates: one story can tag several of your players (a trade, a two-name injury
  // note), which the news lib emits as one item PER player — the same headline repeated down
  // the tab. Keep one row per story (by headline), unioning the teams it touches and taking the
  // worst severity, so a story that hits two of your players reads as one row affecting both.
  const byStory = new Map();
  for (const n of news) {
    const key = (n.headline || '').trim().toLowerCase() || n.id;
    const prev = byStory.get(key);
    if (!prev) { byStory.set(key, { ...n, affectedLeagues: [...(n.affectedLeagues || [])] }); continue; }
    const seen = new Set(prev.affectedLeagues.map((l) => l.leagueId));
    for (const l of n.affectedLeagues || []) if (!seen.has(l.leagueId)) { prev.affectedLeagues.push(l); seen.add(l.leagueId); }
    prev.affectedCount = prev.affectedLeagues.length;
    prev.startingCount = prev.affectedLeagues.filter((l) => l.starting).length;
    if ((rank[n.severity] || 0) > (rank[prev.severity] || 0)) prev.severity = n.severity;
  }
  news = [...byStory.values()];

  // Live: the ESPN feed is league-wide, so keep only news that touches a player
  // you actually roster — that's the "which of my teams does this hit" moat.
  if (!config.demoMode) news = news.filter((n) => n.affectedCount > 0);

  // Most impactful first: high severity, then most teams affected where you start him.
  news.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0) || b.startingCount - a.startingCount);
  return { news };
}

module.exports = { getExposure, getNews, enrichForExposure };
