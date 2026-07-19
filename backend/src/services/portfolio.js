'use strict';

// The command-center home: a portfolio roll-up across every league plus a single
// triage queue of everything that needs the owner's attention.
//
// Kept deliberately light: it uses the lineup overview in "light" mode (no
// per-league point projections / live scores), which halves the MFL calls — the
// difference between usable and rate-limited when you have 15+ leagues.

const config = require('../config');
const demo = require('../demo/fixtures');
const leaguesService = require('./leagues');
const lineupsService = require('./lineups');

const SEV = { high: 3, medium: 2, low: 1 };

function pendingTrades(leagueId) {
  return config.demoMode ? demo.trades(leagueId) : [];
}
function pendingWaivers(leagueId) {
  return config.demoMode ? demo.waivers(leagueId) : [];
}

async function getHome(cookie, token) {
  const [leagues, overview] = await Promise.all([
    leaguesService.listLeagues(cookie),
    lineupsService.getOverview(cookie, token, 'auto', { light: true }),
  ]);

  const items = [];
  let tradeOffers = 0;
  let waiversPending = 0;
  const counts = { injuries: 0, holes: 0, lineupsToSet: 0 };

  for (const l of overview.leagues) {
    if (l.error) continue;
    if (l.status === 'risk') {
      counts.injuries += 1;
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
      counts.holes += 1;
      items.push({
        id: `lineup-hole-${l.leagueId}`,
        type: 'lineup_incomplete',
        severity: 'high',
        action: 'waiver',
        leagueId: l.leagueId,
        leagueName: l.name,
        title: 'No eligible starter — needs a pickup',
        subtitle: 'A slot has no healthy player; hit the waiver wire',
      });
    } else if (l.status === 'unset') {
      counts.lineupsToSet += 1;
      items.push({
        id: `lineup-unset-${l.leagueId}`,
        type: 'lineup_unset',
        severity: 'medium',
        action: 'lineup',
        leagueId: l.leagueId,
        leagueName: l.name,
        title: 'Lineup not set',
        subtitle: 'Set your starters for this week',
      });
    } else if (l.status === 'suboptimal') {
      items.push({
        id: `lineup-sub-${l.leagueId}`,
        type: 'lineup_suboptimal',
        severity: 'medium',
        action: 'lineup',
        leagueId: l.leagueId,
        leagueName: l.name,
        title: 'A better lineup is available',
        subtitle: 'Optimize your starters',
      });
    }
  }

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

  return {
    week: overview.week,
    portfolio: {
      leagues: leagues.length,
      needAttention: overview.summary.needAttention,
      injuries: counts.injuries,
      holes: counts.holes,
      lineupsToSet: counts.lineupsToSet,
      tradeOffers,
      waiversPending,
      actionItems: items.length,
    },
    teams: leagues.map((l) => ({ leagueId: l.leagueId, name: l.name })),
    triage: items,
  };
}

module.exports = { getHome };
