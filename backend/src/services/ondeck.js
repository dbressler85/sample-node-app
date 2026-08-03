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
const leagueFormat = require('../lib/leagueformat');

// Waiver runs this soon count as "on deck" even with no claim in yet — the window to get one in.
const WAIVER_IMMINENT_MS = 3 * 24 * 60 * 60 * 1000;

const LINEUP_DETAIL = {
  risk: 'unavailable starter',
  incomplete: 'empty slot — needs a pickup',
  unset: 'not set yet',
  suboptimal: 'points available',
};

// The two roster specialists a lone bye can wipe (positions are normalized to 'PK'/'DEF' everywhere).
const LONE_LABEL = { PK: 'K', DEF: 'DEF' }; // short, for the row label
const LONE_WORD = { PK: 'kicker', DEF: 'defense' }; // long, for the detail sentence

// Present a lineup-lock item from its wiped positions: when a starting slot has no healthy body, name
// it and deep-link to that position's waiver board; otherwise fall back to the generic status detail.
// Factored out so it can be RE-applied after a bye-gap steals the K/DEF callout (see the de-dupe pass):
// `slotNames` (optional) are the prettier slot labels for the first paint; the re-derive passes none and
// uses the positions themselves. Idempotent given the same inputs.
function decorateLock(item, positions, slotNames) {
  if (!positions.length) {
    item.label = 'Lineups lock';
    item.detail = LINEUP_DETAIL[item.status] || item.status;
    delete item.replacements;
    return;
  }
  const slotLabel = [...new Set(slotNames && slotNames.length ? slotNames : positions)].join(' + ');
  item.label = `${slotLabel} slot needs a body`;
  item.detail = `No healthy player for your ${slotLabel} slot — everyone eligible is out or on bye. Pick up a ${positions.join('/')}.`;
  item.replacements = { leagueId: item.leagueId, positions, sort: 'projection' };
}

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
        // A "wiped position" — a starting slot no healthy player can fill because everyone eligible
        // is injured/on bye — can surface as 'incomplete' (lineup set, slot empty) OR 'risk' (the
        // starter you set is now out and you've no healthy backup) OR 'unset'. In every case the fix
        // is the same: pick up a replacement. When we know which positions are wiped, name them and
        // attach a deep-link to the waiver board pre-filtered to that position and sorted by this
        // week's projection, so the fix is one tap away.
        const wiped = l.unfillablePositions || [];
        const wipedSlots = (l.unfillable || []).map((s) => s.name);
        // `status` + `wiped` are carried through so the push layer can re-fire when the lineup PROBLEM
        // changes mid-week (e.g. a starter newly ruled OUT flips optimal→suboptimal or opens a new hole)
        // — not just once per kickoff. See notifications.buildFor's lineup key.
        const item = { type: 'lineup_lock', kind: 'action', leagueId: l.leagueId, leagueName: l.name, at: locks.kickoff, status: l.status, wiped, action: 'lineup' };
        decorateLock(item, wiped, wipedSlots);
        items.push(item);
      }
    }
    // Honesty (docs/UX_GUARDRAILS): a league whose lineup read FAILED comes back as { error } with no
    // status, so the loop above skips it — leaving a league we couldn't check looking exactly like one
    // that's fine. Surface it as its own action so "unknown" never masquerades as "optimal". Tied to
    // the same lock deadline so it sorts alongside the real lineup items.
    for (const l of locks.leagues) {
      if (l.status || !l.error) continue; // a real status (handled above) or a healthy read → not this
      items.push({
        type: 'lineup_unknown', kind: 'action', leagueId: l.leagueId, leagueName: l.name, at: locks.kickoff,
        status: 'error', action: 'lineup', label: 'Lineup status unavailable',
        detail: "Couldn't load your lineup for this league — open it to confirm your starters before lock.",
      });
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

  // Roster-legality scan — two quiet, week-costing problems, both from the SAME per-league roster read
  // (fanned out once). In-season only live (offseason has no injury/bye data); always in demo.
  //   • IR VIOLATION — a player parked on Injured Reserve who is no longer IR-eligible: healthy (ACTIVE)
  //     in MFL's injury data. The feed carries the IR/OUT designation, so a genuinely injured IR player
  //     reads IR/OUT and is skipped; only a recovered one reads ACTIVE. An illegal IR can lock your
  //     lineup — activate or drop.
  //   • BYE GAP — your ONLY kicker or ONLY defense is on bye this week, so that starting slot has no one
  //     to field. We count across the ACTIVE roster only (starters+bench); an IR/taxi body can't play, so
  //     it doesn't save the slot. Gated on the league actually STARTING that position (from its lineup
  //     requirements) so we never cry "gap" at a slot the league doesn't use. Fix = stream a body, so it
  //     deep-links to the waiver board pre-filtered to the position — the same one-tap fix as a wiped slot.
  if (config.demoMode || inSeason) {
    const scan = await Promise.all((leagueList || []).map(async (l) => {
      const [roster, reqs] = await Promise.all([
        rosterService.myRosterEnriched(cookie, l.leagueId).catch(() => null),
        leagueFormat.requirements(cookie, l).catch(() => []),
      ]);
      return { league: l, roster, reqs };
    }));
    for (const { roster: r, reqs } of scan) {
      if (!r) continue;
      // — IR violation —
      const bad = (r.ir || []).filter((p) => p.availability && p.availability.status === 'ACTIVE');
      if (bad.length) {
        const names = bad.map((p) => String(p.name).split(',')[0]);
        items.push({
          type: 'ir_violation', kind: 'action', leagueId: r.leagueId, leagueName: r.name, at: null,
          action: 'roster',
          label: bad.length === 1 ? 'Illegal IR' : `${bad.length} illegal IR`,
          players: bad.map((p) => ({ id: p.id, name: p.name, position: p.position })),
          detail: `${names.join(', ')} ${bad.length === 1 ? 'is' : 'are'} healthy but on IR — activate or drop to keep your roster legal`,
        });
      }
      // — Bye gap: a lone K / lone DEF on bye —
      const elig = new Set((reqs || []).flatMap((s) => s.eligible || []));
      const active = [...(r.starters || []), ...(r.bench || [])]; // IR/taxi can't play this week
      const onBye = (p) => p.availability && p.availability.status === 'BYE';
      const gaps = [];
      for (const pos of ['PK', 'DEF']) {
        if (!elig.has(pos)) continue; // league doesn't start this position → not a gap
        const held = active.filter((p) => p.position === pos);
        if (held.length === 1 && onBye(held[0])) gaps.push({ pos, player: held[0] });
      }
      if (gaps.length) {
        const positions = gaps.map((g) => g.pos);
        const which = gaps.map((g) => LONE_LABEL[g.pos]).join(' & ');
        const detail = gaps.length === 1
          ? `Your only ${LONE_WORD[gaps[0].pos]} (${String(gaps[0].player.name).split(',')[0]}) is on bye — no one to fill the slot. Stream a ${LONE_LABEL[gaps[0].pos]}.`
          : `Your only ${gaps.map((g) => LONE_WORD[g.pos]).join(' and only ')} are on bye — no one to fill those slots. Stream replacements.`;
        items.push({
          type: 'bye_gap', kind: 'action', leagueId: r.leagueId, leagueName: r.name, at: null,
          action: 'waiver',
          label: `Only ${which} on bye`,
          players: gaps.map((g) => ({ id: g.player.id, name: g.player.name, position: g.player.position })),
          positions,
          replacements: { leagueId: r.leagueId, positions, sort: 'projection' },
          detail,
        });
      }
    }
  }

  // De-dupe a bye gap against a lineup lock: both can point at the same wiped K/DEF slot. The bye_gap is
  // the specific, better-worded owner of that callout, so strip those positions from the same league's
  // lineup lock. If that leaves the lock with no wiped slots AND it was ONLY an 'incomplete' (a pure hole,
  // nothing else wrong), drop the now-redundant lock. A lock that also covers an unavailable starter
  // ('risk'), points on the bench ('suboptimal'), or an unset lineup keeps its row — re-decorated to the
  // generic framing so it no longer double-names the K/DEF the bye_gap already owns.
  const byePositions = new Map(); // leagueId -> Set(positions owned by a bye_gap)
  for (const it of items) if (it.type === 'bye_gap') byePositions.set(it.leagueId, new Set(it.positions));
  const visible = items.filter((it) => {
    if (it.type !== 'lineup_lock') return true;
    const owned = byePositions.get(it.leagueId);
    if (!owned || !owned.size) return true;
    const remaining = (it.wiped || []).filter((p) => !owned.has(p));
    if (remaining.length === (it.wiped || []).length) return true; // nothing overlapped → untouched
    if (!remaining.length && it.status === 'incomplete') return false; // the only hole WAS the bye gap
    it.wiped = remaining;
    decorateLock(it, remaining); // re-derive label/detail/replacements without the bye_gap's positions
    return true;
  });

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
