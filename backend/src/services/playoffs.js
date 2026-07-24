'use strict';

// Playoff brackets for a league (M6+). Reads MFL's `playoffBrackets` export and normalizes it into
// a rounds→games shape the mobile bracket screen renders. My franchise is flagged so the UI can
// highlight my path. Demo returns a hand-built Championship bracket fixture.
//
// NOTE: MFL's per-game field names in this export are NOT yet confirmed against a live sample, so the
// normalizer is deliberately tolerant — it accepts the common alternatives for each field (home/away
// objects vs flat, franchise_id/id, points/score, winner/winner_franchise_id, playoffRound/round,
// playoffGame/game/matchup). Once a real response is in hand, the alternatives can be trimmed to the
// real keys. Fully fail-soft: any read/parse trouble yields an "unavailable" bracket, never a 500.

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

// First present, non-empty MFL field among candidates (each $t-unwrapped).
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) {
      const v = mfl.text(obj[k]);
      if (v !== '') return v;
    }
  }
  return null;
}

// Normalize one side (home/away) of a playoff game. MFL may nest it as an object
// ({franchise_id, points, seed}) or spell the ids flat on the game — the caller passes whichever
// it found. Resolves the team name from the franchise-name map; `mine` flags my franchise.
function normSide(node, names, myFranchiseId) {
  if (node == null) return null;
  // A side can be a bare franchise-id string, or an object with the id under one of these keys.
  const fid = typeof node === 'object' ? pick(node, 'franchise_id', 'id', 'franchise') : mfl.text(node);
  if (!fid) return null;
  const seedRaw = typeof node === 'object' ? pick(node, 'seed', 'playoffSeed') : null;
  const ptsRaw = typeof node === 'object' ? pick(node, 'points', 'score', 'fpts') : null;
  const seed = seedRaw != null ? mfl.num(seedRaw) : null;
  const points = ptsRaw != null ? mfl.num(ptsRaw) : null;
  return {
    franchiseId: String(fid),
    name: names.get(String(fid)) || `Team ${fid}`,
    seed: Number.isFinite(seed) ? seed : null,
    points: Number.isFinite(points) ? points : null,
    mine: String(fid) === String(myFranchiseId),
  };
}

function normGame(g, idx, names, myFranchiseId) {
  // home/away as nested objects, else flat *_franchise / *_id fields on the game.
  const home = normSide(g.home != null ? g.home : { franchise_id: pick(g, 'home_franchise', 'home_id', 'top') }, names, myFranchiseId);
  const away = normSide(g.away != null ? g.away : { franchise_id: pick(g, 'away_franchise', 'away_id', 'bottom') }, names, myFranchiseId);
  const winner = pick(g, 'winner', 'winner_franchise_id', 'winning_franchise');
  const winnerFranchiseId = winner ? String(winner) : null;
  const hasPoints = (home && home.points != null) || (away && away.points != null);
  const status = winnerFranchiseId ? 'final' : hasPoints ? 'live' : 'scheduled';
  return {
    id: pick(g, 'id', 'game_id', 'gameId') || `g${idx}`,
    home,
    away,
    winnerFranchiseId,
    status,
    mine: !!((home && home.mine) || (away && away.mine)),
  };
}

// A human title for a round given its position and size (last round is the Championship).
function roundTitle(node, index, total) {
  const explicit = pick(node, 'title', 'name', 'round_name');
  if (explicit) return explicit;
  if (index === total - 1) return 'Championship';
  if (index === total - 2) return 'Semifinals';
  if (index === total - 3) return 'Quarterfinals';
  return `Round ${index + 1}`;
}

function normBracket(b, names, myFranchiseId) {
  const rawRounds = mfl.toArray(b.playoffRound != null ? b.playoffRound : b.round);
  const rounds = rawRounds.map((r, i) => {
    const games = mfl.toArray(r.playoffGame != null ? r.playoffGame : r.game != null ? r.game : r.matchup)
      .map((g, gi) => normGame(g, gi, names, myFranchiseId));
    const weekRaw = pick(r, 'week', 'w');
    return { week: weekRaw != null ? mfl.num(weekRaw) : null, title: roundTitle(r, i, rawRounds.length), games };
  });
  return { id: pick(b, 'id', 'bracket_id') || 'bracket', name: pick(b, 'name', 'bracket_name') || 'Playoffs', rounds };
}

async function getBrackets(cookie, leagueId) {
  if (config.demoMode) {
    const fx = demo.playoffBrackets(leagueId);
    return fx || { leagueId: String(leagueId), name: null, myFranchiseId: null, available: false, brackets: [] };
  }
  const league = await findLeague(cookie, leagueId);
  const empty = { leagueId: league.leagueId, name: league.name, myFranchiseId: league.franchiseId, available: false, brackets: [] };
  try {
    const [raw, names] = await Promise.all([
      mflRepo.playoffBrackets(league, cookie),
      leaguesService.franchiseNames(cookie, league),
    ]);
    const brackets = raw
      .map((b) => normBracket(b, names, league.franchiseId))
      .filter((b) => b.rounds.some((r) => r.games.length));
    if (!brackets.length) return empty; // no brackets configured / not seeded yet (offseason, etc.)
    return { leagueId: league.leagueId, name: league.name, myFranchiseId: league.franchiseId, available: true, brackets };
  } catch (e) {
    console.log(`[playoffs] league=${league.leagueId} error=${e.message}`);
    return empty;
  }
}

module.exports = { getBrackets };
