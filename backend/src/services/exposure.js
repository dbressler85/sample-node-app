'use strict';

// Cross-league player exposure — the moat feature. See every league you roster a
// given player in, whether you're starting him, and his status/value, all at once.
// When news breaks, you know instantly which of your teams it touches.

const config = require('../config');
const demo = require('../demo/fixtures');
const newsLib = require('../lib/news');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const standingLib = require('../lib/standing');
const playerTags = require('../store/playerTags');
const watchStore = require('../store/watchlist');

async function gather(cookie, token) {
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const rosters = (
    await Promise.all(
      leagues.map((l) =>
        rosterService
          .getRoster(cookie, l.leagueId)
          .then((roster) => ({ league: l, roster }))
          .catch(() => null)
      )
    )
  ).filter(Boolean);
  return { totalLeagues: leagues.length, rosters };
}

async function getExposure(cookie, token) {
  const { totalLeagues, rosters } = await gather(cookie, token);
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
      exposurePct: totalLeagues ? Math.round((p.leagues.length / totalLeagues) * 100) : 0,
      tag: tags[String(p.id)] || null,
      watched: watchSet.has(String(p.id)),
    }))
    .sort((a, b) => b.count - a.count || (b.value || 0) - (a.value || 0));

  return {
    totalLeagues,
    players,
    summary: {
      uniquePlayers: players.length,
      // Players you roster in more than one league — your concentration.
      multiLeague: players.filter((p) => p.count > 1).length,
    },
  };
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

module.exports = { getExposure, getNews };
