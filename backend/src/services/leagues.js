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

module.exports = { listLeagues, normalize };
