'use strict';

// The command-center home: a portfolio roll-up across every league plus a single
// triage queue of everything that needs the owner's attention — so a 5+ league
// manager opens one screen and immediately knows what to do and where.

const config = require('../config');
const demo = require('../demo/fixtures');
const leaguesService = require('./leagues');
const lineupsService = require('./lineups');
const scoreboardService = require('./scoreboard');

const SEV = { high: 3, medium: 2, low: 1 };

function pendingTrades(leagueId) {
  return config.demoMode ? demo.trades(leagueId) : [];
}
function pendingWaivers(leagueId) {
  return config.demoMode ? demo.waivers(leagueId) : [];
}

async function getHome(cookie, token) {
  const [leagues, overview, scoreboard] = await Promise.all([
    leaguesService.listLeagues(cookie),
    lineupsService.getOverview(cookie, token, 'auto'),
    scoreboardService.getScoreboard(cookie),
  ]);

  const items = [];
  let tradeOffers = 0;
  let waiversPending = 0;

  // Lineup-driven triage (reuses M2.5 availability/optimizer signals).
  for (const l of overview.leagues) {
    if (l.error) continue;
    if (l.status === 'risk') {
      const who = (l.warnings || []).filter((w) => w.playerId).map((w) => `${w.name.split(',')[0]} (${w.status})`);
      items.push({
        id: `lineup-risk-${l.leagueId}`,
        type: 'lineup_risk',
        severity: 'high',
        action: 'lineup',
        leagueId: l.leagueId,
        leagueName: l.name,
        title: 'Unavailable player in your lineup',
        subtitle: who.join(', ') || 'A starter can’t play',
      });
    } else if (l.status === 'incomplete') {
      items.push({
        id: `lineup-empty-${l.leagueId}`,
        type: 'lineup_incomplete',
        severity: 'high',
        action: 'waiver', // no eligible starter -> hit the waiver wire
        leagueId: l.leagueId,
        leagueName: l.name,
        title: 'Empty starting slot — add a player',
        subtitle: 'No eligible starter; pick one up on waivers',
      });
    } else if (l.status === 'suboptimal') {
      items.push({
        id: `lineup-sub-${l.leagueId}`,
        type: 'lineup_suboptimal',
        severity: 'medium',
        action: 'lineup',
        leagueId: l.leagueId,
        leagueName: l.name,
        title: `+${l.delta} projected points available`,
        subtitle: 'A better lineup is one tap away',
      });
    }
  }

  // Trades + waivers.
  for (const league of leagues) {
    for (const t of pendingTrades(league.leagueId)) {
      tradeOffers += 1;
      items.push({
        id: `trade-${league.leagueId}-${t.id}`,
        type: 'trade_offer',
        severity: 'high',
        action: 'trade',
        leagueId: league.leagueId,
        leagueName: league.name,
        title: `Trade offer from ${t.from}`,
        subtitle: `They give ${t.gives.join(', ')} for ${t.gets.join(', ')}`,
      });
    }
    for (const w of pendingWaivers(league.leagueId)) {
      waiversPending += 1;
      items.push({
        id: `waiver-${league.leagueId}-${w.player}`,
        type: 'waiver_pending',
        severity: 'low',
        action: 'waiver',
        leagueId: league.leagueId,
        leagueName: league.name,
        title: `Waiver claim pending: ${w.player.split(',')[0]}`,
        subtitle: `$${w.bid} · runs ${w.runsAt}`,
      });
    }
  }

  items.sort((a, b) => (SEV[b.severity] || 0) - (SEV[a.severity] || 0));

  const winning = scoreboard.summary.winning;
  return {
    week: overview.week,
    portfolio: {
      leagues: leagues.length,
      weekRecord: `${winning}-${scoreboard.summary.total - winning}`,
      liveGames: scoreboard.summary.live,
      closeGames: scoreboard.summary.close,
      lineupsNeedAttention: overview.summary.needAttention,
      risky: overview.summary.risky,
      pointsAvailable: overview.summary.pointsAvailable,
      tradeOffers,
      waiversPending,
      actionItems: items.length,
    },
    teams: leagues.map((l) => ({ leagueId: l.leagueId, name: l.name })),
    triage: items,
  };
}

module.exports = { getHome };
