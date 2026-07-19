'use strict';

// League discovery: the "one login -> all my leagues" magic.
// MFL's `myleagues` returns every league the authenticated account belongs to,
// including that account's franchise id and the league's host url.

const mfl = require('../lib/mfl');
const config = require('../config');
const demo = require('../demo/fixtures');

function normalize(l) {
  const url = l.url || '';
  return {
    leagueId: String(l.league_id),
    name: l.name || `League ${l.league_id}`,
    url,
    host: mfl.hostFromLeagueUrl(url),
    franchiseId: l.franchise_id ? String(l.franchise_id) : null,
    franchiseName: l.franchise_name || null,
  };
}

async function listLeagues(cookie) {
  if (config.demoMode) return demo.leagues();

  const res = await mfl.exportRequest('myleagues', { cookie, FRANCHISE_NAMES: 1 });
  const leagues = mfl.toArray(res && res.leagues && res.leagues.league);
  return leagues.map(normalize);
}

// Map of franchiseId -> team name for a league (from the league export). Cached
// (league is a static type), so calling it per screen is cheap. Used to turn
// opponent franchise ids into real team names on the scoreboard/dashboard/matchup.
async function franchiseNames(cookie, league) {
  if (config.demoMode) return new Map();
  try {
    const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
    const fr = mfl.toArray(res && res.league && res.league.franchises && res.league.franchises.franchise);
    return new Map(fr.map((f) => [String(f.id), f.name || `Team ${f.id}`]));
  } catch (e) {
    return new Map();
  }
}

module.exports = { listLeagues, normalize, franchiseNames };
