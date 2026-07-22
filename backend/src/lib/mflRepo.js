'use strict';

const mfl = require('./mfl');

// Repository layer over MFL's export envelopes.
//
// MFL wraps every collection in a type-named envelope whose single-vs-many child is returned as
// an object-or-array (see mfl.toArray). That unwrap — the pairing of an export *type* with its
// envelope *path*, e.g. `rosters` -> `res.rosters.franchise` — was duplicated inline across ~15
// services as `mfl.toArray(res && res.X && res.X.Y)`. A renamed or re-nested MFL field therefore
// meant hunting down every call site, and MFL's raw shape leaked into services that shouldn't
// care about it.
//
// Own that unwrap here, once. Each reader issues the export (always host + L from the league,
// plus any extra params the caller passes verbatim — FRANCHISE, W, maxAge, …) and returns a
// normalized array. Behavior is identical to the inline unwrap it replaces.
//
// LIVE-MODE ONLY: services keep their own `config.demoMode` branch and only reach the repo on the
// live path. That keeps this a pure MFL reader for now, and leaves it as the natural seam a
// demo/live data-source can later hang on (the repo, not every service, would own the split).

async function read(type, league, cookie, params = {}) {
  return mfl.exportRequest(type, { host: league.host, cookie, L: league.leagueId, ...params });
}

// `rosters` export -> every franchise's roster ({ id, player: [...] }).
async function rosters(league, cookie, params = {}) {
  const res = await read('rosters', league, cookie, params);
  return mfl.toArray(res && res.rosters && res.rosters.franchise);
}

// `leagueStandings` export -> per-franchise standings rows.
async function standings(league, cookie, params = {}) {
  const res = await read('leagueStandings', league, cookie, params);
  return mfl.toArray(res && res.leagueStandings && res.leagueStandings.franchise);
}

// `league` export -> the franchise directory (note the extra nesting: league.franchises.franchise).
async function leagueFranchises(league, cookie, params = {}) {
  const res = await read('league', league, cookie, params);
  return mfl.toArray(res && res.league && res.league.franchises && res.league.franchises.franchise);
}

module.exports = { read, rosters, standings, leagueFranchises };
