'use strict';

// The command-center home: a portfolio roll-up across every league plus a single
// triage queue of everything that needs the owner's attention.
//
// Two entry points:
//  - getHome:        computes the whole thing server-side (used as a fallback).
//  - getLeagueTriage: one league's contribution, so the app can load leagues
//                     progressively and paint as each arrives.
//
// Uses the lineup overview in "light" mode (no per-league projections / live
// scores) to keep MFL calls low when you have many leagues.

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

// The single lineup-derived triage item for a league (or null if it's fine).
function lineupItem(l) {
  if (l.error) return null;
  if (l.status === 'risk') {
    const who = (l.warnings || []).filter((w) => w.playerId).map((w) => `${w.name.split(',')[0]} (${w.status})`);
    return { id: `lineup-risk-${l.leagueId}`, type: 'lineup_risk', severity: 'high', action: 'lineup', leagueId: l.leagueId, leagueName: l.name, title: 'Unavailable player in your lineup', subtitle: who.join(', ') || 'A starter can’t play' };
  }
  if (l.status === 'incomplete') {
    return { id: `lineup-hole-${l.leagueId}`, type: 'lineup_incomplete', severity: 'high', action: 'waiver', leagueId: l.leagueId, leagueName: l.name, title: 'No eligible starter — needs a pickup', subtitle: 'A slot has no healthy player; hit the waiver wire' };
  }
  if (l.status === 'unset') {
    return { id: `lineup-unset-${l.leagueId}`, type: 'lineup_unset', severity: 'medium', action: 'lineup', leagueId: l.leagueId, leagueName: l.name, title: 'Lineup not set', subtitle: 'Set your starters for this week' };
  }
  if (l.status === 'suboptimal') {
    return { id: `lineup-sub-${l.leagueId}`, type: 'lineup_suboptimal', severity: 'medium', action: 'lineup', leagueId: l.leagueId, leagueName: l.name, title: 'A better lineup is available', subtitle: 'Optimize your starters' };
  }
  return null;
}

// Trade + waiver items for one league.
function extraItems(league) {
  const items = [];
  for (const t of pendingTrades(league.leagueId)) {
    items.push({ id: `trade-${league.leagueId}-${t.id}`, type: 'trade_offer', severity: 'high', action: 'trade', leagueId: league.leagueId, leagueName: league.name, title: `Trade offer from ${t.from}`, subtitle: `They give ${t.gives.join(', ')} for ${t.gets.join(', ')}` });
  }
  for (const w of pendingWaivers(league.leagueId)) {
    items.push({ id: `waiver-${league.leagueId}-${w.player}`, type: 'waiver_pending', severity: 'low', action: 'waiver', leagueId: league.leagueId, leagueName: league.name, title: `Waiver claim pending: ${w.player.split(',')[0]}`, subtitle: `$${w.bid} · runs ${w.runsAt}` });
  }
  return items;
}

// One league's triage contribution (status + items), for progressive loading.
async function getLeagueTriage(cookie, token, leagueId) {
  const league = (await leaguesService.listLeagues(cookie)).find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  const l = await lineupsService.getStatus(cookie, token, leagueId, { light: true });
  const items = [];
  const li = lineupItem(l);
  if (li) items.push(li);
  items.push(...extraItems(league));
  return { leagueId: league.leagueId, name: league.name, status: l.status, items };
}

async function getHome(cookie, token) {
  const [leagues, overview] = await Promise.all([
    leaguesService.listLeagues(cookie),
    lineupsService.getOverview(cookie, token, 'auto', { light: true }),
  ]);

  const items = [];
  const counts = { injuries: 0, holes: 0, lineupsToSet: 0 };
  for (const l of overview.leagues) {
    if (l.status === 'risk') counts.injuries += 1;
    else if (l.status === 'incomplete') counts.holes += 1;
    else if (l.status === 'unset') counts.lineupsToSet += 1;
    const li = lineupItem(l);
    if (li) items.push(li);
  }
  let tradeOffers = 0;
  let waiversPending = 0;
  for (const league of leagues) {
    const ex = extraItems(league);
    tradeOffers += ex.filter((i) => i.type === 'trade_offer').length;
    waiversPending += ex.filter((i) => i.type === 'waiver_pending').length;
    items.push(...ex);
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

module.exports = { getHome, getLeagueTriage };
