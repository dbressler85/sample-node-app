'use strict';

// Cross-league player exposure — the moat feature. See every league you roster a
// given player in, whether you're starting him, and his status/value, all at once.
// When news breaks, you know instantly which of your teams it touches.

const config = require('../config');
const demo = require('../demo/fixtures');
const newsLib = require('../lib/news');
const leaguesService = require('./leagues');
const rosterService = require('./roster');

async function gather(cookie) {
  const leagues = await leaguesService.listLeagues(cookie);
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

function bucketOf(roster, id) {
  if (roster.starters.some((p) => p.id === id)) return 'starter';
  if (roster.bench.some((p) => p.id === id)) return 'bench';
  if (roster.ir.some((p) => p.id === id)) return 'ir';
  return 'taxi';
}

async function getExposure(cookie) {
  const { totalLeagues, rosters } = await gather(cookie);
  const map = new Map(); // playerId -> aggregate record

  for (const { league, roster } of rosters) {
    const all = [...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi];
    const startingSet = new Set(roster.starters.map((p) => p.id));
    for (const p of all) {
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
        starting: startingSet.has(p.id),
        bucket: bucketOf(roster, p.id),
      });
    }
  }

  const players = [...map.values()]
    .map((p) => ({
      ...p,
      count: p.leagues.length,
      startingCount: p.leagues.filter((l) => l.starting).length,
      exposurePct: totalLeagues ? Math.round((p.leagues.length / totalLeagues) * 100) : 0,
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
async function getNews(cookie) {
  const exposure = await getExposure(cookie);
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

  // Live: the ESPN feed is league-wide, so keep only news that touches a player
  // you actually roster — that's the "which of my teams does this hit" moat.
  if (!config.demoMode) news = news.filter((n) => n.affectedCount > 0);

  // Most impactful first: high severity, then most teams affected where you start him.
  const rank = { high: 3, medium: 2, low: 1 };
  news.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0) || b.startingCount - a.startingCount);
  return { news };
}

module.exports = { getExposure, getNews };
