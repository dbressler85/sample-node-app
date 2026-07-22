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
// NOTE: when a caller also needs other league-level attributes (waiver flags, roster size, …),
// it must read the raw `league` export itself — this reader only surfaces the franchise array.
async function leagueFranchises(league, cookie, params = {}) {
  const res = await read('league', league, cookie, params);
  return mfl.toArray(res && res.league && res.league.franchises && res.league.franchises.franchise);
}

// `pendingTrades` export -> the pending trade offers (usually scoped with FRANCHISE).
async function pendingTrades(league, cookie, params = {}) {
  const res = await read('pendingTrades', league, cookie, params);
  return mfl.toArray(res && res.pendingTrades && res.pendingTrades.pendingTrade);
}

// `liveScoring` export -> per-franchise live score rows (each nests players.player internally).
async function liveScoring(league, cookie, params = {}) {
  const res = await read('liveScoring', league, cookie, params);
  return mfl.toArray(res && res.liveScoring && res.liveScoring.franchise);
}

// `freeAgents` export -> the league unit(s); each nests player[] the caller flattens.
async function freeAgentUnits(league, cookie, params = {}) {
  const res = await read('freeAgents', league, cookie, params);
  return mfl.toArray(res && res.freeAgents && res.freeAgents.leagueUnit);
}

// `draftResults` export -> the draft unit(s); the caller picks the LEAGUE unit and reads draftPick[].
async function draftResults(league, cookie, params = {}) {
  const res = await read('draftResults', league, cookie, params);
  return mfl.toArray(res && res.draftResults && res.draftResults.draftUnit);
}

// `playerScores` export -> per-player fantasy scores (league-scoped; pass W and PLAYERS).
async function playerScores(league, cookie, params = {}) {
  const res = await read('playerScores', league, cookie, params);
  return mfl.toArray(res && res.playerScores && res.playerScores.playerScore);
}

// `projectedScores` export -> per-player projected points (league-scoped; optionally W).
async function projectedScores(league, cookie, params = {}) {
  const res = await read('projectedScores', league, cookie, params);
  return mfl.toArray(res && res.projectedScores && res.projectedScores.playerScore);
}

// `schedule` export -> the weekly schedule rows (pass W); each nests matchup[].
async function schedule(league, cookie, params = {}) {
  const res = await read('schedule', league, cookie, params);
  return mfl.toArray(res && res.schedule && res.schedule.weeklySchedule);
}

// `calendar` export -> league calendar events (waiver/lock windows, etc.).
async function calendar(league, cookie, params = {}) {
  const res = await read('calendar', league, cookie, params);
  return mfl.toArray(res && res.calendar && res.calendar.event);
}

// `tradeBait` export -> the trade-bait board (note the envelope pluralizes: tradeBaits.tradeBait).
async function tradeBaits(league, cookie, params = {}) {
  const res = await read('tradeBait', league, cookie, params);
  return mfl.toArray(res && res.tradeBaits && res.tradeBaits.tradeBait);
}

// `transactions` export -> the raw transaction rows (add/drop/trade); caller parses each.
async function transactions(league, cookie, params = {}) {
  const res = await read('transactions', league, cookie, params);
  return mfl.toArray(res && res.transactions && res.transactions.transaction);
}

module.exports = {
  read,
  rosters,
  standings,
  leagueFranchises,
  pendingTrades,
  liveScoring,
  freeAgentUnits,
  draftResults,
  playerScores,
  projectedScores,
  schedule,
  calendar,
  tradeBaits,
  transactions,
};
