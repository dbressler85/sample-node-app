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
const rosterService = require('./roster');

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
      items.push({ type: 'draft_clock', kind: 'action', leagueId: d.leagueId, leagueName: d.name, at: null, now: true, action: 'draft', label: "You're on the clock", detail: d.type || 'Draft' });
    } else if (d.status === 'scheduled' && d.startTime) {
      items.push({ type: 'draft_start', kind: 'upcoming', leagueId: d.leagueId, leagueName: d.name, at: d.startTime, action: 'draft', label: 'Draft starts', detail: d.type || null });
    }
  }

  // Lineup locks: only in-season, only for leagues that actually need attention.
  if (locks) {
    for (const l of locks.leagues) {
      if (l.status && l.status !== 'optimal' && l.status !== 'error' && l.status !== 'offseason') {
        items.push({ type: 'lineup_lock', kind: 'action', leagueId: l.leagueId, leagueName: l.name, at: locks.kickoff, action: 'lineup', label: 'Lineups lock', detail: LINEUP_DETAIL[l.status] || l.status });
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

  // Trade deadlines — one resolver owns the precedence (manual override → demo fixture / MFL
  // league calendar). One timed item per league that has an upcoming deadline.
  const deadlines = await Promise.all(leagueList.map((l) => tradesService.effectiveDeadline(cookie, token, l).catch(() => null)));
  leagueList.forEach((l, i) => {
    const dl = deadlines[i];
    if (!dl || dl.at == null || dl.at <= Date.now()) return; // none / already passed → not on deck
    items.push({
      type: 'trade_deadline', kind: 'action', leagueId: l.leagueId, leagueName: l.name, at: new Date(dl.at).toISOString(),
      action: 'trade', label: 'Trade deadline', source: dl.source,
      detail: dl.source === 'mfl' ? 'From your league calendar' : 'Last day to make a trade',
    });
  });

  // Waiver runs: this view is ACTION-ONLY (things that still need you), so a league where you've
  // ALREADY submitted claims is intentionally NOT shown here — there's nothing left to do, and the
  // submitted claims live on the Waivers → Pending tab. The only waiver item that belongs here is a
  // claim-free league whose run is imminent: your window to get a claim in before it closes.
  if (!config.demoMode) {
    const leagues = leagueList;
    const runs = await Promise.all(
      leagues.map((l) => waiversService.nextWaiverRun(cookie, l).catch(() => null))
    );
    leagues.forEach((l, i) => {
      const runMs = runs[i];
      const g = byLeague.get(l.leagueId);
      const claimCount = g ? g.count : 0;
      const imminent = runMs && runMs > Date.now() && runMs - Date.now() <= WAIVER_IMMINENT_MS;
      if (claimCount > 0) return; // already acted — not on deck (see Waivers → Pending)
      if (!imminent) return; // not soon → nothing to do yet
      items.push({
        type: 'waiver_run',
        kind: 'action',
        leagueId: l.leagueId,
        leagueName: l.name,
        at: runMs ? new Date(runMs).toISOString() : null,
        action: 'waiver',
        label: 'Waivers run',
        hasClaims: false,
        claimCount: 0,
        detail: 'no claims yet — window open',
      });
    });
  }

  // Pending trade offers waiting on your response — the one "needs attention" item that isn't a
  // timed deadline. MFL exposes no offer expiry, so these are untimed (sort after timed items).
  for (const o of tradeOv.offers || []) {
    items.push({
      type: 'trade_offer',
      kind: 'action',
      leagueId: o.leagueId,
      leagueName: o.leagueName,
      at: null,
      action: 'trade',
      offerId: o.id,
      label: `Trade offer from ${o.withName || 'another team'}`,
      detail: o.analysis && o.analysis.verdict ? `${o.analysis.verdict} for you` : 'Review and respond',
    });
  }

  // IR violations: a player parked on Injured Reserve who is no longer IR-eligible — healthy
  // (ACTIVE) in MFL's injury data. MFL's injury feed carries the IR/OUT designation, so a
  // genuinely injured IR player reads IR/OUT and is skipped; only a recovered one reads ACTIVE and
  // gets flagged. Most leagues require you to activate or drop him, and an illegal IR can lock your
  // lineup — so it's an action. Live: in-season only (offseason has no injury data). Demo: always.
  if (config.demoMode || inSeason) {
    const rosters = await Promise.all((leagueList || []).map((l) => rosterService.myRosterEnriched(cookie, l.leagueId).catch(() => null)));
    for (const r of rosters) {
      if (!r) continue;
      const bad = (r.ir || []).filter((p) => p.availability && p.availability.status === 'ACTIVE');
      if (!bad.length) continue;
      const names = bad.map((p) => String(p.name).split(',')[0]);
      items.push({
        type: 'ir_violation', kind: 'action', leagueId: r.leagueId, leagueName: r.name, at: null,
        action: 'roster',
        label: bad.length === 1 ? 'Illegal IR' : `${bad.length} illegal IR`,
        players: bad.map((p) => ({ id: p.id, name: p.name, position: p.position })),
        detail: `${names.join(', ')} ${bad.length === 1 ? 'is' : 'are'} healthy but on IR — activate or drop to keep your roster legal`,
      });
    }
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
      // `actions` = items that actually need you (draft clock, lineups, a waiver with no claim in yet,
      // trade offers, trade deadlines). `upcoming` = scheduled/already-acted status (your submitted
      // claims processing, a scheduled draft). The Home tile headlines `actions`.
      actions: visible.filter((i) => i.kind === 'action').length,
      upcoming: visible.filter((i) => i.kind === 'upcoming').length,
      onClock: visible.filter((i) => i.now).length,
      soonest: firstTimed ? firstTimed.at : null,
    },
  };
}

module.exports = { getOnDeck };
