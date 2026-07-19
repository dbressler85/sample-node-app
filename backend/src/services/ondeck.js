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

async function getOnDeck(cookie, token) {
  const week = config.demoMode ? require('../demo/fixtures').week() : await nflLib.currentWeek(cookie);
  const inSeason = !!(week && week >= 1 && week <= 18);
  const items = [];

  // Drafts run year-round in dynasty.
  const draftOv = await draftService.getOverview(cookie, token).catch(() => ({ drafts: [] }));
  for (const d of draftOv.drafts || []) {
    if (d.myOnClock) {
      items.push({ type: 'draft_clock', leagueId: d.leagueId, leagueName: d.name, at: null, now: true, action: 'draft', label: "You're on the clock", detail: d.type || 'Draft' });
    } else if (d.status === 'scheduled' && d.startTime) {
      items.push({ type: 'draft_start', leagueId: d.leagueId, leagueName: d.name, at: d.startTime, action: 'draft', label: 'Draft starts', detail: d.type || null });
    }
  }

  // Lineup locks: only in-season, only for leagues that actually need attention.
  if (inSeason) {
    const kickoff = config.demoMode ? demoNextKickoff() : await nflLib.nextKickoff(cookie, week);
    if (kickoff) {
      const ov = await lineupsService.getOverview(cookie, token, 'auto', { light: true }).catch(() => ({ leagues: [] }));
      for (const l of ov.leagues || []) {
        if (l.status && l.status !== 'optimal' && l.status !== 'error' && l.status !== 'offseason') {
          items.push({ type: 'lineup_lock', leagueId: l.leagueId, leagueName: l.name, at: kickoff, action: 'lineup', label: 'Lineups lock', detail: LINEUP_DETAIL[l.status] || l.status });
        }
      }
    }
  }

  // Waiver runs: pending claims per league. MFL exposes only a human run-time
  // string, so these are label-only (sorted after timestamped items).
  const pend = await waiversService.getPending(cookie, token).catch(() => ({ pending: [] }));
  const byLeague = new Map();
  for (const c of pend.pending || []) {
    if (!byLeague.has(c.leagueId)) byLeague.set(c.leagueId, { leagueName: c.leagueName, count: 0, when: null });
    const g = byLeague.get(c.leagueId);
    g.count += 1;
    if (!g.when && c.processTime) g.when = c.processTime;
  }
  for (const [leagueId, g] of byLeague) {
    items.push({ type: 'waiver_run', leagueId, leagueName: g.leagueName, at: null, atLabel: g.when || null, action: 'waiver', label: 'Waivers process', detail: `${g.count} pending claim${g.count === 1 ? '' : 's'}` });
  }

  // Order: on the clock now → soonest timestamp → label-only/untimed.
  const rank = (i) => (i.now ? 0 : i.at ? 1 : 2);
  items.sort((a, b) => rank(a) - rank(b) || (a.at && b.at ? new Date(a.at) - new Date(b.at) : 0));

  const firstTimed = items.find((i) => i.at);
  return {
    now: new Date().toISOString(),
    phase: inSeason ? 'in_season' : 'offseason',
    items,
    summary: {
      total: items.length,
      onClock: items.filter((i) => i.now).length,
      soonest: firstTimed ? firstTimed.at : null,
    },
  };
}

module.exports = { getOnDeck };
