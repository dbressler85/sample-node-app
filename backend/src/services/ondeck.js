'use strict';

// "On Deck" — the proactive, time-sorted view of what needs the owner next, across
// every league. It answers the multi-leaguer's core question: "which of my leagues
// has a deadline coming, and when?" We aggregate the deadlines we can actually
// anchor in time and sort soonest-first:
//   - draft on the clock now      -> urgent, "now"
//   - draft scheduled start        -> real ISO timestamp (MFL draftResults startTime)
//   - lineup lock                  -> next NFL kickoff (MFL nflSchedule), in-season
//   - waiver run                   -> MFL only gives a human label, not a timestamp,
//                                     so these carry `atLabel` and sort after timed items.
// Honest about limits: MFL doesn't expose a machine-readable waiver-run time or a
// trade deadline, so those are label-only / omitted rather than faked.

const config = require('../config');
const nflLib = require('../lib/nfl');
const draftService = require('./draft');
const lineupsService = require('./lineups');
const waiversService = require('./waivers');
const leaguesService = require('./leagues');
const tradesService = require('./trades');
const tradeDeadlines = require('../store/tradeDeadlines');

// Waiver runs this soon count as "on deck" even with no claim in yet — the window to get one in.
const WAIVER_IMMINENT_MS = 3 * 24 * 60 * 60 * 1000;

const LINEUP_DETAIL = {
  risk: 'unavailable starter',
  incomplete: 'empty slot — needs a pickup',
  unset: 'not set yet',
  suboptimal: 'points available',
};

// A synthetic "next kickoff" for demo mode (no real nflSchedule kickoffs), ~20h
// out so the view shows a realistic upcoming lock.
function demoNextKickoff() {
  const d = new Date(Date.now() + 20 * 60 * 60 * 1000);
  return d.toISOString();
}

// Lineup-lock inputs: the next kickoff + each league's lineup status. Grouped so
// it can run concurrently with the draft/waiver reads. In-season only.
async function lineupLocks(cookie, token, week) {
  const kickoff = config.demoMode ? demoNextKickoff() : await nflLib.nextKickoff(cookie, week);
  if (!kickoff) return null;
  const ov = await lineupsService.getOverview(cookie, token, 'auto', { light: true }).catch(() => ({ leagues: [] }));
  return { kickoff, leagues: ov.leagues || [] };
}

async function getOnDeck(cookie, token) {
  const week = config.demoMode ? require('../demo/fixtures').week() : await nflLib.currentWeek(cookie);
  const inSeason = !!(week && week >= 1 && week <= 18);
  const items = [];

  // The three cross-league aggregations are independent — run them concurrently
  // instead of one-after-another (draft overview + lineup status + waiver pending
  // each fan out per league, so serializing them tripled On Deck's load time).
  const [draftOv, locks, pend, tradeOv] = await Promise.all([
    draftService.getOverview(cookie, token).catch(() => ({ drafts: [] })),
    inSeason ? lineupLocks(cookie, token, week).catch(() => null) : Promise.resolve(null),
    waiversService.getPending(cookie, token).catch(() => ({ pending: [] })),
    tradesService.getOverview(cookie, token).catch(() => ({ offers: [] })),
  ]);

  // Drafts run year-round in dynasty.
  for (const d of draftOv.drafts || []) {
    if (d.myOnClock) {
      items.push({ type: 'draft_clock', leagueId: d.leagueId, leagueName: d.name, at: null, now: true, action: 'draft', label: "You're on the clock", detail: d.type || 'Draft' });
    } else if (d.status === 'scheduled' && d.startTime) {
      items.push({ type: 'draft_start', leagueId: d.leagueId, leagueName: d.name, at: d.startTime, action: 'draft', label: 'Draft starts', detail: d.type || null });
    }
  }

  // Lineup locks: only in-season, only for leagues that actually need attention.
  if (locks) {
    for (const l of locks.leagues) {
      if (l.status && l.status !== 'optimal' && l.status !== 'error' && l.status !== 'offseason') {
        items.push({ type: 'lineup_lock', leagueId: l.leagueId, leagueName: l.name, at: locks.kickoff, action: 'lineup', label: 'Lineups lock', detail: LINEUP_DETAIL[l.status] || l.status });
      }
    }
  }
  // Waiver runs on deck are TWO things, shown distinctly:
  //   • leagues where you already have claims in (any run time), and
  //   • leagues whose next run is imminent (≤3 days) even with no claim yet — your window to act.
  // The owner's leagues — used for waiver runs (live) AND the manual trade deadlines below.
  const leagueList = await leaguesService.listLeagues(cookie).catch(() => []);

  const byLeague = new Map(); // leagueId -> { leagueName, count, when }
  for (const c of pend.pending || []) {
    if (!byLeague.has(c.leagueId)) byLeague.set(c.leagueId, { leagueName: c.leagueName, count: 0, when: null });
    const g = byLeague.get(c.leagueId);
    g.count += 1;
    if (!g.when && c.processTime) g.when = c.processTime;
  }

  // Trade deadlines — MFL DOES carry them on the league calendar, so use that automatically; a
  // manual entry (for a league without one on the calendar) overrides. One timed item per league.
  const manualDeadlines = tradeDeadlines.all(token);
  const autoDeadlines = {};
  if (!config.demoMode) {
    const ds = await Promise.all(leagueList.map((l) => tradesService.nextTradeDeadline(cookie, l).catch(() => null)));
    leagueList.forEach((l, i) => { if (ds[i]) autoDeadlines[String(l.leagueId)] = ds[i]; });
  }
  for (const l of leagueList) {
    const lid = String(l.leagueId);
    const m = manualDeadlines[lid];
    let atMs = null;
    let source = null;
    if (m) {
      const d = new Date(`${m}T23:59:59Z`);
      if (!Number.isNaN(d.getTime())) { atMs = d.getTime(); source = 'manual'; }
    } else if (autoDeadlines[lid]) {
      atMs = autoDeadlines[lid];
      source = 'mfl';
    }
    if (atMs == null || atMs <= Date.now()) continue; // none / already passed → not on deck
    items.push({
      type: 'trade_deadline', leagueId: l.leagueId, leagueName: l.name, at: new Date(atMs).toISOString(),
      action: 'trade', label: 'Trade deadline', source,
      detail: source === 'mfl' ? 'From your league calendar' : 'Last day to make a trade',
    });
  }

  if (config.demoMode) {
    // Demo has no machine-readable run time — surface the claim leagues (all "have claims").
    for (const [leagueId, g] of byLeague) {
      items.push({
        type: 'waiver_run', leagueId, leagueName: g.leagueName, at: null, atLabel: g.when || null,
        action: 'waiver', label: 'Waivers process', hasClaims: true, claimCount: g.count,
        detail: `${g.count} claim${g.count === 1 ? '' : 's'} in`,
      });
    }
  } else {
    // Live: resolve each league's next run time so waiver items sort by time (not dumped last),
    // and so a claim-free league with an imminent run still shows up.
    const leagues = leagueList;
    const runs = await Promise.all(
      leagues.map((l) => waiversService.nextWaiverRun(cookie, l).catch(() => null))
    );
    leagues.forEach((l, i) => {
      const runMs = runs[i];
      const g = byLeague.get(l.leagueId);
      const claimCount = g ? g.count : 0;
      const imminent = runMs && runMs > Date.now() && runMs - Date.now() <= WAIVER_IMMINENT_MS;
      if (claimCount === 0 && !imminent) return; // no claim + not soon → not on deck
      items.push({
        type: 'waiver_run',
        leagueId: l.leagueId,
        leagueName: l.name,
        at: runMs ? new Date(runMs).toISOString() : null,
        atLabel: runMs ? null : g && g.when ? g.when : null,
        action: 'waiver',
        label: 'Waivers process',
        hasClaims: claimCount > 0,
        claimCount,
        detail: claimCount > 0 ? `${claimCount} claim${claimCount === 1 ? '' : 's'} in` : 'no claims yet — window open',
      });
    });
  }

  // Pending trade offers waiting on your response — the one "needs attention" item that isn't a
  // timed deadline. MFL exposes no offer expiry, so these are untimed (sort after timed items).
  for (const o of tradeOv.offers || []) {
    items.push({
      type: 'trade_offer',
      leagueId: o.leagueId,
      leagueName: o.leagueName,
      at: null,
      action: 'trade',
      offerId: o.id,
      label: `Trade offer from ${o.withName || 'another team'}`,
      detail: o.analysis && o.analysis.verdict ? `${o.analysis.verdict} for you` : 'Review and respond',
    });
  }

  // (On Deck is time-sorted, so pinning doesn't reorder deadlines.)
  const visible = items;

  // Order: on the clock now → soonest timestamp → label-only/untimed.
  const rank = (i) => (i.now ? 0 : i.at ? 1 : 2);
  visible.sort((a, b) => rank(a) - rank(b) || (a.at && b.at ? new Date(a.at) - new Date(b.at) : 0));

  const firstTimed = visible.find((i) => i.at);
  return {
    now: new Date().toISOString(),
    phase: inSeason ? 'in_season' : 'offseason',
    items: visible,
    summary: {
      total: visible.length,
      onClock: visible.filter((i) => i.now).length,
      soonest: firstTimed ? firstTimed.at : null,
    },
  };
}

module.exports = { getOnDeck };
