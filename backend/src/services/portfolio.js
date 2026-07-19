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
const mfl = require('../lib/mfl');
const playersLib = require('../lib/players');
const leaguesService = require('./leagues');
const lineupsService = require('./lineups');
const waiverStore = require('../store/waivers');

const SEV = { high: 3, medium: 2, low: 1 };

// Pending trade offers awaiting my response. Live: MFL pendingTrades (best-effort
// — field names vary, so it's defensive and resolves ids to names where it can).
async function pendingTrades(cookie, league) {
  if (config.demoMode) return demo.trades(league.leagueId);
  try {
    const res = await mfl.exportRequest('pendingTrades', { host: league.host, cookie, L: league.leagueId, FRANCHISE: league.franchiseId });
    const list = mfl.toArray(res && res.pendingTrades && res.pendingTrades.pendingTrade);
    if (!list.length) return [];
    const [byId, names] = await Promise.all([playersLib.load(cookie), leaguesService.franchiseNames(cookie, league)]);
    const label = (tok) => {
      const t = String(tok).trim();
      if (!t) return null;
      if (/^\d+$/.test(t)) return playersLib.resolve(byId, t).name.split(',')[0];
      const yr = t.match(/(20\d{2})/);
      return yr ? `${yr[1]} pick` : 'pick';
    };
    const toks = (v) => String(v || '').split(/[,;|]/).map(label).filter(Boolean);
    return list
      .filter((tr) => String(tr.offeredto != null ? tr.offeredto : tr.offeredTo) === league.franchiseId)
      .map((tr, i) => ({
        id: String(tr.trade_id || tr.id || i),
        from: names.get(String(tr.offeringteam != null ? tr.offeringteam : tr.offeringTeam)) || 'Another team',
        gives: toks(tr.willGiveUp != null ? tr.willGiveUp : tr.will_give_up),
        gets: toks(tr.willReceiveInReturn != null ? tr.willReceiveInReturn : tr.willReceive),
      }));
  } catch (e) {
    return [];
  }
}

// My pending waiver/FAAB claims. Live: from our claim store (what the app has
// submitted). Demo keeps its fixture.
function pendingWaivers(token, league) {
  if (config.demoMode) return demo.waivers(league.leagueId);
  return waiverStore
    .list(token, league.leagueId, [])
    .filter((c) => (c.status || 'pending') === 'pending')
    .map((c) => ({
      player: (c.add && c.add.name) || 'Player',
      bid: c.bid != null ? c.bid : null,
      runsAt: c.processTime || 'next run',
    }));
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
async function extraItems(cookie, token, league) {
  const items = [];
  for (const t of await pendingTrades(cookie, league)) {
    const detail = t.gives.length || t.gets.length ? `They give ${t.gives.join(', ') || '—'} for ${t.gets.join(', ') || '—'}` : 'Tap to review the offer';
    items.push({ id: `trade-${league.leagueId}-${t.id}`, type: 'trade_offer', severity: 'high', action: 'trade', leagueId: league.leagueId, leagueName: league.name, title: `Trade offer from ${t.from}`, subtitle: detail });
  }
  for (const w of pendingWaivers(token, league)) {
    items.push({ id: `waiver-${league.leagueId}-${w.player}`, type: 'waiver_pending', severity: 'low', action: 'waiver', leagueId: league.leagueId, leagueName: league.name, title: `Waiver claim pending: ${w.player.split(',')[0]}`, subtitle: `${w.bid != null ? `$${w.bid} · ` : ''}runs ${w.runsAt}` });
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
  items.push(...(await extraItems(cookie, token, league)));
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
  const extra = await Promise.all(leagues.map((league) => extraItems(cookie, token, league)));
  for (const ex of extra) {
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
