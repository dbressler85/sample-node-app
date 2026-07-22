'use strict';

// Live Sunday scoreboard across every league. A raw in-progress score is
// meaningless without context, so each matchup carries players-yet-to-play,
// projected final, and a live win probability — and the board is sorted by
// closeness so the games that need attention float to the top.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const nflLib = require('../lib/nfl');
const leaguesService = require('./leagues');
const playersLib = require('../lib/players');

// Resolve a list of player ids to {name, position} for the "still to play" line — so the
// scoreboard shows WHO you have coming, not just a count. Best-effort: unknown ids drop out.
async function resolveYetToPlay(cookie, ids) {
  if (!ids || !ids.length) return [];
  const byId = await playersLib.load(cookie);
  return ids.map((id) => {
    const p = playersLib.resolve(byId, id);
    return { id: String(id), name: p.name, position: p.position };
  }).filter((p) => p.name && p.name !== 'Player undefined');
}

// Win probability from the projected-final margin, with uncertainty that grows
// with how many players are still to play (more remaining -> closer to a coin flip).
function winProbability(margin, playersRemaining) {
  const sigma = 6 * Math.sqrt(Math.max(playersRemaining, 0)) + 8;
  return Math.round((1 / (1 + Math.exp(-margin / sigma))) * 100) / 100;
}

function buildCard(league, live, opponentName) {
  const me = live.me;
  const opp = live.opp;
  const remaining = (me.yetToPlay || 0) + (opp.yetToPlay || 0);
  const margin = (me.projectedFinal || 0) - (opp.projectedFinal || 0);
  const winProb = winProbability(margin, remaining);
  const locked = remaining === 0;
  const status = locked
    ? me.score >= opp.score ? 'won' : 'lost'
    : winProb >= 0.65 ? 'favored' : winProb <= 0.35 ? 'trailing' : 'tossup';

  return {
    leagueId: league.leagueId,
    name: league.name,
    opponent: opponentName,
    me: { score: me.score, yetToPlay: me.yetToPlay, projectedFinal: me.projectedFinal },
    opp: { score: opp.score, yetToPlay: opp.yetToPlay, projectedFinal: opp.projectedFinal },
    liveMargin: Math.round((me.score - opp.score) * 10) / 10,
    projectedMargin: Math.round(margin * 10) / 10,
    winProb,
    locked,
    close: !locked && winProb >= 0.35 && winProb <= 0.65,
    status,
  };
}

async function liveForLeague(cookie, league) {
  if (config.demoMode) {
    const live = demo.live(league.leagueId);
    if (!live) return null;
    const mp = demo.matchupProjection(league.leagueId);
    const card = buildCard(league, live, mp ? mp.opponent : 'Opponent');
    card.me.yetToPlayers = await resolveYetToPlay(cookie, live.me.yetToPlayIds);
    return card;
  }
  // Live: MFL liveScoring exposes per-franchise score, playersYetToPlay and
  // gameSecondsRemaining. Best-effort; verify against a real account.
  try {
    const res = await mfl.exportRequest('liveScoring', { host: league.host, cookie, L: league.leagueId });
    const franchises = mfl.toArray(res && res.liveScoring && res.liveScoring.franchise);
    console.log(`[liveScoring] league=${league.leagueId} franchises=${franchises.length}`);
    const mine = franchises.find((f) => String(f.id) === league.franchiseId);
    if (!mine) return null; // no live data (e.g. offseason / no games in progress)
    const opp = franchises.find((f) => String(f.id) === String(mine.opp_id));
    const toCard = (f) => ({
      score: Number(f && f.score) || 0,
      yetToPlay: Number(f && f.playersYetToPlay) || 0,
      projectedFinal: Number(f && f.projectedScore) || Number(f && f.score) || 0,
    });
    const names = await leaguesService.franchiseNames(cookie, league);
    const oppName = opp ? names.get(String(opp.id)) || `Team ${opp.id}` : 'Opponent';
    const card = buildCard(league, { me: toCard(mine), opp: toCard(opp) }, oppName);
    // Which of MY players are still to play. liveScoring nests per-player status under
    // franchise.players.player[]; a player with a full game clock (or an explicit not-yet
    // status) hasn't played. Best-effort — falls back to an empty list (the count still shows)
    // if the sub-shape differs. Verify against a real liveScoring response.
    const myPlayers = mfl.toArray(mine.players && mine.players.player);
    const ytpIds = myPlayers
      .filter((pp) => {
        const secs = Number(pp.gameSecondsRemaining);
        const status = String(pp.status || '').toLowerCase();
        return (Number.isFinite(secs) && secs >= 3600) || status === 'yettoplay' || status === 'notplayed';
      })
      .map((pp) => pp.id);
    card.me.yetToPlayers = await resolveYetToPlay(cookie, ytpIds);
    return card;
  } catch (e) {
    return null;
  }
}

async function getScoreboard(cookie) {
  const leagues = await leaguesService.listLeagues(cookie);
  const cards = (await Promise.all(leagues.map((l) => liveForLeague(cookie, l).catch(() => null)))).filter(Boolean);

  // Closest games first; locked games sink to the bottom.
  cards.sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? 1 : -1;
    return Math.abs(a.winProb - 0.5) - Math.abs(b.winProb - 0.5);
  });

  const live = cards.filter((c) => !c.locked);
  return {
    week: config.demoMode ? demo.week() : await nflLib.currentWeek(cookie),
    games: cards,
    summary: {
      total: cards.length,
      live: live.length,
      winning: cards.filter((c) => (c.locked ? c.status === 'won' : c.winProb >= 0.5)).length,
      close: cards.filter((c) => c.close).length,
    },
  };
}

module.exports = { getScoreboard, winProbability };
