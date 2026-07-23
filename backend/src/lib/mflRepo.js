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

const truthy = (v) => v === '1' || v === 1 || v === true || String(v).toLowerCase() === 'true';

// Normalize one `playerRosterStatuses.playerStatus` element. Shape (from a live sample):
//   rostered  -> { id, roster_franchise: { franchise_id, status } }  (status ∈ R/S/NS/IR/TS;
//                 roster_franchise can be an ARRAY in multi-copy leagues)
//   free agent-> { id, is_fa, cant_add?, locked? }
//   bad id    -> { id, error: "..." }
function normPlayerStatus(ps) {
  const franchises = mfl.toArray(ps && ps.roster_franchise)
    .filter(Boolean)
    .map((rf) => ({ franchiseId: String(rf.franchise_id), status: String(rf.status || '') }));
  return {
    id: String(ps && ps.id),
    error: (ps && ps.error) || null,
    isFreeAgent: ps && 'is_fa' in ps ? truthy(ps.is_fa) : false,
    cantAdd: truthy(ps && ps.cant_add),
    locked: truthy(ps && ps.locked),
    franchises, // [] when a free agent or errored
  };
}

// `playerRosterStatus` export -> authoritative per-player status in ONE league: who rosters the
// player (and in what slot), or whether he's a free agent that can/can't be added (locked, etc.).
// `players` is a single id or an array/CSV of ids. Returns a normalized array (see normPlayerStatus).
async function playerRosterStatus(league, cookie, players, params = {}) {
  const P = Array.isArray(players) ? players.join(',') : String(players);
  const res = await read('playerRosterStatus', league, cookie, { P, ...params });
  return mfl.toArray(res && res.playerRosterStatuses && res.playerRosterStatuses.playerStatus).map(normPlayerStatus);
}

// One pending waiver request -> { system, round, timestamp, comments, picks[] }. `addsDrops` is a
// CSV of the same underscore tokens the import uses: FAAB = "add_bid_drop", FCFS = "add_drop"
// ("0000" = no drop). Confirmed against a live sample: addsDrops "14080_0_14849,13133_0_14849".
function normPendingRequest(req, system) {
  const picks = String((req && req.addsDrops) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const p = tok.split('_');
      const dropAt = system === 'faab' ? 2 : 1;
      const bid = system === 'faab' ? Number(p[1]) || 0 : null;
      const drop = p[dropAt] && p[dropAt] !== '0000' ? p[dropAt] : null;
      return { add: p[0] || null, bid, drop };
    });
  return {
    system,
    round: req && req.round != null && req.round !== '' ? Number(req.round) : null,
    timestamp: req && req.timestamp ? Number(req.timestamp) : null,
    comments: (req && req.comments) || '',
    picks,
  };
}

// `pendingWaivers` export -> this franchise's queued (unprocessed) waiver requests. FAAB requests
// live under `blindBidWaiverRequest`, FCFS priority under `waiverRequest`. Returns a normalized
// array (usually 0 or 1). Each item carries the waiver `round`, which is otherwise hard to source.
async function pendingWaivers(league, cookie, params = {}) {
  const res = await read('pendingWaivers', league, cookie, params);
  const pw = (res && res.pendingWaivers) || {};
  return [
    ...mfl.toArray(pw.blindBidWaiverRequest).map((r) => normPendingRequest(r, 'faab')),
    ...mfl.toArray(pw.waiverRequest).map((r) => normPendingRequest(r, 'fcfs')),
  ];
}

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// Parse a draft-pick token. Future picks are FP_<originalOwner>_<year>_<round> (rounds are the
// ACTUAL round). Current-year picks are DP_<round-1>_<pick-1> (both one LESS than the real value).
function parsePickToken(token) {
  const t = String(token || '');
  let m = /^FP_(\d+)_(\d+)_(\d+)$/.exec(t);
  if (m) return { kind: 'future', originalOwner: m[1], year: Number(m[2]), round: Number(m[3]) };
  m = /^DP_(\d+)_(\d+)$/.exec(t);
  if (m) return { kind: 'current', round: Number(m[1]) + 1, pick: Number(m[2]) + 1 };
  return { kind: 'unknown' };
}

// One franchise's tradable assets -> { id, playerIds[], faab, picks[] }. `picks` carries the raw
// token plus its parsed round/year/owner (the token encodes the ORIGINAL owner; the pick is listed
// under whoever CURRENTLY holds it — so this is the authoritative "what can each team trade").
function normFranchiseAssets(fr) {
  const playerIds = mfl.toArray(fr && fr.players && fr.players.player).map((p) => String(p.id));
  const faab = fr && fr.blindBiddingDollars && fr.blindBiddingDollars.amount != null && fr.blindBiddingDollars.amount !== ''
    ? Number(fr.blindBiddingDollars.amount)
    : null;
  const picks = mfl.toArray(fr && fr.futureYearDraftPicks && fr.futureYearDraftPicks.draftPick).map((dp) => ({
    token: String(dp && dp.pick),
    description: stripHtml(dp && dp.description),
    ...parsePickToken(dp && dp.pick),
  }));
  return { id: String(fr && fr.id), playerIds, faab, picks };
}

// `assets` export -> every franchise's tradable assets (players, FAAB $, future/current draft
// picks) in ONE read, normalized. The single authoritative source for trade construction (vs.
// composing rosters + futureDraftPicks + FAAB separately).
async function assets(league, cookie, params = {}) {
  const res = await read('assets', league, cookie, params);
  return mfl.toArray(res && res.assets && res.assets.franchise).map(normFranchiseAssets);
}

// Interpret a normalized status into add eligibility for THIS league. addable=false carries a
// human reason. (Note: intended for the immediate free-agency path — during a waiver period a
// claim is a bid, not a direct add, so this is not a gate for FAAB/priority claims.)
function addEligibility(status) {
  if (!status) return { addable: false, reason: 'No roster status returned.' };
  if (status.error) return { addable: false, reason: status.error };
  if (status.franchises.length) return { addable: false, reason: `Already rostered (franchise ${status.franchises[0].franchiseId}).` };
  if (status.cantAdd) return { addable: false, reason: 'MyFantasyLeague won’t allow adding this player right now.' };
  if (status.locked) return { addable: false, reason: 'This player is locked (his game has started).' };
  if (status.isFreeAgent) return { addable: true, reason: null };
  return { addable: false, reason: 'Not an available free agent.' };
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
  playerRosterStatus,
  addEligibility,
  pendingWaivers,
  assets,
  parsePickToken,
};
