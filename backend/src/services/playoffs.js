'use strict';

// Playoff brackets for a league (M6+). MFL's `playoffBrackets` export only returns bracket
// DEFINITIONS (name, startWeek, teamsInvolved, bracketWinnerTitle) — NOT the games. The actual
// matchups + scores live in the `schedule` export (playoff weeks show each matchup's score and a
// per-franchise result W/L). So we COMPOSE the two: read the bracket definitions, pull the
// playoff-week games from the schedule, and reconstruct rounds → games by tracing advancement.
// Confirmed against a real completed season (2025, league 69597): weeks 15/16/17 each carry only the
// bracket games, and the championship final is the week where both teams are still undefeated in the
// bracket; the same-week game between the two semifinal LOSERS is the 3rd-place (consolation) game.
//
// The champion is the undefeated team — surfaced as `champion` for the trophy auto-detect. Demo
// returns a hand-built fixture. Fully fail-soft: any read/parse trouble yields available:false.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const mflRepo = require('../lib/mflRepo');
const leaguesService = require('./leagues');

async function findLeague(cookie, leagueId) {
  const leagues = await leaguesService.listLeagues(cookie);
  const league = leagues.find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  return league;
}

const pickText = (obj, ...keys) => {
  for (const k of keys) {
    if (obj && obj[k] != null) {
      const v = mfl.text(obj[k]);
      if (v !== '') return v;
    }
  }
  return null;
};

// The "championship" bracket among the definitions: the one whose winner title names a champion,
// else the biggest field, else the earliest-starting.
function pickChampionshipBracket(defs) {
  if (!defs.length) return null;
  const byTitle = defs.find((b) => /champ/i.test(mfl.text(b.bracketWinnerTitle) + ' ' + mfl.text(b.name)));
  if (byTitle) return byTitle;
  return [...defs].sort(
    (a, b) => (mfl.num(b.teamsInvolved) || 0) - (mfl.num(a.teamsInvolved) || 0) || (mfl.num(a.startWeek) || 0) - (mfl.num(b.startWeek) || 0)
  )[0];
}

// One schedule matchup → { aId, bId, aScore, bScore, winnerId, loserId, played }. MFL gives an
// explicit per-franchise result (W/L); fall back to the score when it's absent (unplayed → neither).
function parseMatchup(m) {
  const fr = mfl.toArray(m && m.franchise);
  if (fr.length < 2) return null;
  const [A, B] = fr;
  const aId = mfl.text(A.id);
  const bId = mfl.text(B.id);
  const aScore = mfl.num(A.score);
  const bScore = mfl.num(B.score);
  const aRes = mfl.text(A.result).toUpperCase();
  const bRes = mfl.text(B.result).toUpperCase();
  let winnerId = null;
  if (aRes === 'W') winnerId = aId;
  else if (bRes === 'W') winnerId = bId;
  else if (Number.isFinite(aScore) && Number.isFinite(bScore) && aScore !== bScore) winnerId = aScore > bScore ? aId : bId;
  const played = aRes === 'W' || aRes === 'L' || bRes === 'W' || bRes === 'L' || Number.isFinite(aScore);
  return {
    aId,
    bId,
    aScore: Number.isFinite(aScore) ? aScore : null,
    bScore: Number.isFinite(bScore) ? bScore : null,
    winnerId,
    loserId: winnerId ? (winnerId === aId ? bId : aId) : null,
    played,
  };
}

// Round title from its distance to the final (the last round is the Championship).
function roundTitle(index, total) {
  if (total <= 1) return 'Final';
  const fromEnd = total - 1 - index;
  if (fromEnd === 0) return 'Championship';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${index + 1}`;
}

function side(fid, score, names, myFranchiseId, seeds) {
  if (!fid) return null;
  const seed = seeds && seeds.get(String(fid));
  return {
    franchiseId: String(fid),
    name: names.get(String(fid)) || `Team ${fid}`,
    seed: seed != null ? seed : null, // playoff seed = final-standings rank (null when standings unread)
    points: Number.isFinite(score) ? score : null,
    mine: String(fid) === String(myFranchiseId),
  };
}

function buildBracket(id, name, winnerTitle, rounds, names, myFranchiseId, seeds) {
  return {
    id: String(id),
    name,
    winnerTitle: winnerTitle || null,
    rounds: rounds.map((r, i) => ({
      week: r.week,
      title: roundTitle(i, rounds.length),
      games: r.games.map((g, gi) => ({
        id: `w${r.week}g${gi}`,
        home: side(g.aId, g.aScore, names, myFranchiseId, seeds),
        away: side(g.bId, g.bScore, names, myFranchiseId, seeds),
        winnerFranchiseId: g.winnerId || null,
        status: g.played ? 'final' : 'scheduled',
        mine: g.aId === myFranchiseId || g.bId === myFranchiseId,
      })),
    })),
  };
}

// Reconstruct the championship bracket (and a 3rd-place bracket if present) from the definitions +
// the schedule's playoff-week games. Returns { available, brackets[], champion }.
function reconstruct(defs, weeklySchedule, names, myFranchiseId, seeds) {
  const champMeta = pickChampionshipBracket(defs);
  if (!champMeta) return { available: false, brackets: [] };
  const startWeek = mfl.num(champMeta.startWeek);
  if (!Number.isFinite(startWeek)) return { available: false, brackets: [] };

  // Playoff games by week (only weeks at/after the bracket start; those carry just the bracket games).
  const byWeek = new Map();
  for (const wk of mfl.toArray(weeklySchedule)) {
    const w = mfl.num(wk && wk.week);
    if (!Number.isFinite(w) || w < startWeek) continue;
    const games = mfl.toArray(wk.matchup).map(parseMatchup).filter(Boolean);
    if (games.length) byWeek.set(w, games);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  if (!weeks.length) return { available: false, brackets: [] };
  const finalWeek = weeks[weeks.length - 1];

  // Walk the weeks; a team's losses so far tell us who's still in the championship hunt. In the final
  // week the game between two still-undefeated teams is the CHAMPIONSHIP; a game between two teams
  // that each already lost once is the 3rd-place (consolation) game.
  const losses = {};
  const champRounds = [];
  const thirdGames = [];
  for (const w of weeks) {
    const games = byWeek.get(w);
    if (w < finalWeek) {
      champRounds.push({ week: w, games });
      for (const g of games) if (g.loserId) losses[g.loserId] = (losses[g.loserId] || 0) + 1;
    } else {
      const undefeated = (g) => (losses[g.aId] || 0) === 0 && (losses[g.bId] || 0) === 0;
      const champGames = games.filter(undefeated);
      const rest = games.filter((g) => !undefeated(g));
      if (champGames.length) champRounds.push({ week: w, games: champGames });
      thirdGames.push(...rest);
    }
  }
  if (!champRounds.length) return { available: false, brackets: [] };

  const brackets = [buildBracket(champMeta.id || 'championship', champMeta.name || 'Playoff Bracket', champMeta.bracketWinnerTitle, champRounds, names, myFranchiseId, seeds)];

  // A 3rd-place / consolation bracket, if the definitions name one and we split games into it.
  const thirdMeta = defs.find((b) => b !== champMeta && /3rd|third|consol|place/i.test(mfl.text(b.bracketWinnerTitle) + ' ' + mfl.text(b.name)));
  if (thirdGames.length) {
    brackets.push(buildBracket((thirdMeta && thirdMeta.id) || 'consolation', (thirdMeta && thirdMeta.name) || 'Consolation', (thirdMeta && thirdMeta.bracketWinnerTitle) || '3rd Place', [{ week: finalWeek, games: thirdGames }], names, myFranchiseId, seeds));
  }

  // Champion = winner of the championship bracket's final game.
  const finalRound = champRounds[champRounds.length - 1];
  const finalGame = finalRound && finalRound.games[0];
  const championId = finalGame ? finalGame.winnerId : null;
  const champion = championId
    ? { franchiseId: String(championId), name: names.get(String(championId)) || `Team ${championId}`, title: pickText(champMeta, 'bracketWinnerTitle') || 'League Champion' }
    : null;

  return { available: true, brackets, champion };
}

async function getBrackets(cookie, leagueId) {
  if (config.demoMode) {
    const fx = demo.playoffBrackets(leagueId);
    return fx || { leagueId: String(leagueId), name: null, myFranchiseId: null, available: false, brackets: [], champion: null };
  }
  const league = await findLeague(cookie, leagueId);
  const empty = { leagueId: league.leagueId, name: league.name, myFranchiseId: league.franchiseId, available: false, brackets: [], champion: null };
  try {
    const [defs, sched, names, standings] = await Promise.all([
      mflRepo.playoffBrackets(league, cookie),
      mflRepo.schedule(league, cookie),
      leaguesService.franchiseNames(cookie, league),
      // Playoff seeds = final-standings rank. leagueStandings is returned in standings order, so a
      // franchise's seed is its 1-based position. Fail-soft: no standings → seeds stay null.
      mflRepo.standings(league, cookie).catch(() => []),
    ]);
    if (!defs.length) return empty;
    const seeds = new Map();
    standings.forEach((f, i) => { const id = mfl.text(f && f.id); if (id) seeds.set(id, i + 1); });
    const built = reconstruct(defs, sched, names, league.franchiseId, seeds);
    if (!built.available) return empty;
    return { leagueId: league.leagueId, name: league.name, myFranchiseId: league.franchiseId, ...built };
  } catch (e) {
    console.log(`[playoffs] league=${league.leagueId} error=${e.message}`);
    return empty;
  }
}

// The champion of a SPECIFIC past season for a league (year overrides the season in the URL path).
// Returns { exists, champion } — `exists` is false when the league ran no playoff bracket that year
// (didn't exist yet / not configured), which lets a caller stop scanning earlier years. Detection
// only needs the champion's franchise id, so we skip the franchise-name fetch (names resolve to
// `Team <id>`; callers supply their own display name). Fail-soft.
async function championFor(cookie, league, year) {
  try {
    const [defs, sched] = await Promise.all([
      mflRepo.playoffBrackets(league, cookie, { year }),
      mflRepo.schedule(league, cookie, { year }),
    ]);
    if (!defs.length) return { exists: false, champion: null };
    const built = reconstruct(defs, sched, new Map(), league.franchiseId);
    return { exists: true, champion: built.available ? built.champion : null };
  } catch (e) {
    return { exists: false, champion: null };
  }
}

module.exports = { getBrackets, championFor };
