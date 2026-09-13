'use strict';

// Live Sunday scoreboard across every league. A raw in-progress score is
// meaningless without context, so each matchup carries players-yet-to-play,
// projected final, and a live win probability — and the board is sorted by
// closeness so the games that need attention float to the top.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const mflRepo = require('../lib/mflRepo');
const nflLib = require('../lib/nfl');
const rosterStatus = require('../lib/rosterStatus');
const { mapLeaguesSettled, partiality } = require('../lib/safe');
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

async function liveForLeague(cookie, league, { fastFail = false, week = null } = {}) {
  if (config.demoMode) {
    const live = demo.live(league.leagueId);
    if (!live) return null;
    const mp = demo.matchupProjection(league.leagueId);
    const card = buildCard(league, live, mp ? mp.opponent : 'Opponent');
    card.me.yetToPlayers = await resolveYetToPlay(cookie, live.me.yetToPlayIds);
    return card;
  }
  // Live: MFL liveScoring exposes per-franchise score, playersYetToPlay and gameSecondsRemaining.
  // Best-effort; verify against a real account. A read FAILURE (throttle / expired cookie) THROWS — never
  // degrades to null: a null return means "loaded fine, nothing live", and conflating a failed read with
  // that would (a) drive a false-clean `partial` on the scoreboard and (b) blank a live matchup card the
  // client would otherwise keep from cache (non-destructive errors, C4). fastFail only controls the RETRY
  // BUDGET: the single-league matchup card reads with a bounded 1-retry ladder so a throttle throws in ~1s
  // (client keeps the last-known card) instead of hanging ~5–12s and 502-ing; the scoreboard fan-out keeps
  // the full retries. The distinction "failed vs empty" is identical on both paths — only the speed differs.
  // Pass the detected week explicitly — MFL's own liveScoring "current week" pointer can lag the real
  // week early on game day, returning an empty feed for a week that's actually underway.
  const liveParams = week ? { W: week } : {};
  const franchises = await mflRepo.liveScoring(league, cookie, liveParams, fastFail ? { retries: 1, maxRetries: 1 } : {});
  console.log(`[liveScoring] league=${league.leagueId} week=${week || '—'} franchises=${franchises.length}`);
  const mine = franchises.find((f) => String(f.id) === league.franchiseId);
  if (!mine) {
    // MFL liveScoring returns rows only INSIDE a live game window; between windows on game day (after
    // some games finish, before the next kickoff) it's empty and the whole board went dark even though
    // the week is underway with points already on the board. Rebuild the matchup from the persistent
    // week reads the rest of the app uses (schedule + playerScores + projectedScores + rosters).
    if (!config.demoMode && week) return weekResultsForLeague(cookie, league, week);
    return null; // offseason / no schedule — genuinely nothing to show
  }
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
}

// This week's opponent franchise id from the league's fantasy schedule (the pairing source the lineups
// screen already uses pre-game). Null on a bye / unscheduled week.
async function opponentFranchiseIdFromSchedule(cookie, league, week) {
  const weeks = await mflRepo.schedule(league, cookie, { W: week });
  const wk = weeks.find((w) => String(w.week) === String(week)) || weeks[0];
  for (const m of mfl.toArray(wk && wk.matchup)) {
    const ids = mfl.toArray(m && m.franchise).map((f) => String(f.id));
    if (ids.includes(String(league.franchiseId))) return ids.find((id) => id !== String(league.franchiseId)) || null;
  }
  return null;
}

// Fallback matchup card when MFL liveScoring is empty (between game windows / a lagging live-week
// pointer). Rebuilt from PERSISTENT week reads the app already uses in production — the schedule
// (pairing), playerScores (points banked so far), projectedScores (rest-of-day for starters yet to
// play), and rosters (each side's SET starters). A starter with no score entry yet is counted "yet to
// play", so a matchup mid-week reads live (points in, players still coming) instead of falsely final.
// Best-effort: any gap → null, so the board is never worse than the old liveScoring-only path.
async function weekResultsForLeague(cookie, league, week) {
  if (!week) return null;
  try {
    const oppId = await opponentFranchiseIdFromSchedule(cookie, league, week);
    if (!oppId) return null; // bye / unscheduled
    const [franchises, actualList, projList, names] = await Promise.all([
      mflRepo.rosters(league, cookie),
      mflRepo.playerScores(league, cookie, { W: week }),
      mflRepo.projectedScores(league, cookie, { W: week }).catch(() => []),
      leaguesService.franchiseNames(cookie, league),
    ]);
    const startersFor = (fid) => {
      const fr = franchises.find((f) => String(f.id) === String(fid));
      if (!fr) return [];
      return mfl.toArray(fr.player).filter((p) => rosterStatus.rosterSlot(p) === 'starter').map((p) => String(p.id));
    };
    const myStarters = startersFor(league.franchiseId);
    const oppStarters = startersFor(oppId);
    if (!myStarters.length && !oppStarters.length) return null; // no lineups set yet — nothing to score
    // Only light up once the week has ACTUALLY started scoring (some game has been played). Before
    // kickoff and in the offseason, playerScores is empty/all-zero — returning a card there would
    // fabricate a 0–0 "live" game, so bail to the honest empty state instead.
    if (!actualList.some((p) => (Number(p.score) || 0) > 0)) return null;
    const actual = new Map(actualList.map((p) => [String(p.id), Number(p.score) || 0]));
    const proj = new Map(projList.map((p) => [String(p.id), Number(p.score) || 0]));
    // A starter already in the scored feed has played; one that isn't is still to come (his projection
    // rolls into the projected final). liveScoring's own projectedFinal is unavailable here, so we
    // reconstruct it as banked points + the rest-of-day projection.
    const sideOf = (starters) => {
      let score = 0; let yetToPlay = 0; let projRest = 0; const ytpIds = [];
      for (const id of starters) {
        if (actual.has(id)) score += actual.get(id);
        else { yetToPlay += 1; projRest += proj.get(id) || 0; ytpIds.push(id); }
      }
      score = Math.round(score * 10) / 10;
      return { score, yetToPlay, projectedFinal: Math.round((score + projRest) * 10) / 10, ytpIds };
    };
    const me = sideOf(myStarters);
    const opp = sideOf(oppStarters);
    const card = buildCard(league, { me, opp }, names.get(String(oppId)) || `Team ${oppId}`);
    card.me.yetToPlayers = await resolveYetToPlay(cookie, me.ytpIds);
    console.log(`[scoreboard.fallback] league=${league.leagueId} week=${week} me=${me.score}/${me.yetToPlay}ytp opp=${opp.score}/${opp.yetToPlay}ytp locked=${card.locked}`);
    return card;
  } catch (e) {
    console.log(`[scoreboard.fallback] league=${league.leagueId} error=${e.message}`);
    return null;
  }
}

async function getScoreboard(cookie) {
  const leagues = await leaguesService.listLeagues(cookie);
  // Settled fan-out: a league whose live read THREW is ok:false (a genuine throttle drop), while a
  // league with no live matchup is ok:true/value:null (offseason, loaded fine). `partial` is driven by
  // the former only — so an offseason board no longer reports a false "some leagues failed", and a real
  // throttle still surfaces "N of M leagues loaded" instead of silently showing fewer matchups.
  // Detect the week ONCE and thread it into every league's read — so liveScoring is asked for the real
  // week and the persistent fallback knows which week to rebuild. (Also the header week below.)
  const week = config.demoMode ? demo.week() : await nflLib.currentWeek(cookie);
  const settled = await mapLeaguesSettled(leagues, (l) => liveForLeague(cookie, l, { week }), 'scoreboard.live');
  const cards = settled.filter((s) => s.ok && s.value).map((s) => s.value);

  // Closest games first; locked games sink to the bottom.
  cards.sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? 1 : -1;
    return Math.abs(a.winProb - 0.5) - Math.abs(b.winProb - 0.5);
  });

  const live = cards.filter((c) => !c.locked);
  return {
    week,
    games: cards,
    // Standard partial-load honesty envelope (mirrors dashboard/exposure): partial + leaguesLoaded
    // (leagues we could READ, incl. offseason-empty ones) + leagueCount, computed the shared way.
    ...partiality(settled),
    summary: {
      total: cards.length,
      live: live.length,
      winning: cards.filter((c) => (c.locked ? c.status === 'won' : c.winProb >= 0.5)).length,
      close: cards.filter((c) => c.close).length,
    },
  };
}

// One league's live matchup — the scoped slice the single-league cockpit shows, instead of fanning
// the whole cross-league board out just to render one card. `game` is null when there's nothing live
// (offseason, bye, or an unstarted week) — a clean, expected state, distinct from a read failure (which
// throws). Reuses the exact card `getScoreboard` builds, so the cockpit and the cross-league Scores tab
// render identical numbers.
async function getLeagueMatchup(cookie, leagueId) {
  const leagues = await leaguesService.listLeagues(cookie);
  const league = leagues.find((l) => String(l.leagueId) === String(leagueId));
  if (!league) return { week: null, game: null };
  const week = config.demoMode ? demo.week() : await nflLib.currentWeek(cookie);
  const game = await liveForLeague(cookie, league, { fastFail: true, week }); // foreground card — fail fast, degrade to empty
  return {
    week,
    game: game || null,
  };
}

module.exports = { getScoreboard, getLeagueMatchup, winProbability };
