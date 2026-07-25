'use strict';

// Drafts (M6). League-aware: detect each league's draft (scheduled / in progress
// / complete), show the board and whose turn it is, surface the user's picks,
// rank the available pool by dynasty value, and make a pick when on the clock.
//
// Live reads MFL draftResults; demo uses fixtures + a seeded store so a draft can
// actually progress. Draft order/rounds aren't always exposed by MFL, so the live
// path degrades gracefully to "made picks + available pool" when it can't build
// the full grid.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const mflRepo = require('../lib/mflRepo');
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');
const leagueContext = require('../lib/leagueContext');
const playersLib = require('../lib/players');
const picksLib = require('../lib/picks');
const adpLib = require('../lib/adp');
const draftClockLib = require('../lib/draftClock');
const leaguesService = require('./leagues');
const waiversService = require('./waivers');
const rosterService = require('./roster');
const draftStore = require('../store/draft');
const draftListStore = require('../store/draftList');
const playerTags = require('../store/playerTags');
const { createMemo } = require('../lib/memo');

// Draft "has it been held?" status changes rarely (only while a draft is live), and it's
// asked once per league by several screens (Watch tab, Home alerts, player profile). Memoize
// it so those don't each fire a fresh draftResults read — and concurrent callers coalesce.
const draftOpenMemo = createMemo({ ttlMs: config.mflCacheTtlMs });

function resolvePlayer(byId, id, enr) {
  const p = playersLib.resolve(byId, id);
  return { id: p.id, name: p.name, position: p.position, team: p.team, value: enr.value(id), age: enr.age(id) };
}

// Expand a draft's order × rounds (snake-aware) into ordered slots, filling in any
// made picks (matched by round + franchise). If no order is known (live fallback),
// the slots are simply the picks that have been made.
function buildSlots(draft) {
  const order = draft.order || [];
  const rounds = draft.rounds || 0;
  // Key made picks by round+pick (not franchise), so a franchise holding two
  // picks in a round via a trade doesn't collide onto one slot.
  const made = new Map();
  for (const p of draft.picks || []) made.set(`${p.round}-${p.pick}`, p);

  if (!order.length || !rounds) {
    return (draft.picks || [])
      .slice()
      .sort((a, b) => a.round - b.round || a.pick - b.pick)
      .map((p, i) => ({ overall: i + 1, round: p.round, pick: p.pick, franchiseId: p.franchiseId, playerId: p.playerId || null, keeper: !!p.keeper }));
  }

  const slots = [];
  let overall = 0;
  for (let r = 1; r <= rounds; r++) {
    const roundOrder = draft.snake && r % 2 === 0 ? [...order].reverse() : order;
    roundOrder.forEach((franchiseId, i) => {
      overall += 1;
      const mp = made.get(`${r}-${i + 1}`);
      slots.push({ overall, round: r, pick: i + 1, franchiseId, playerId: mp ? mp.playerId || null : null, keeper: !!(mp && mp.keeper) });
    });
  }
  return slots;
}

// --- data loaders (demo vs live) --------------------------------------------

// A draftPick row counts as MADE only with a real player id. MFL leaves unmade slots empty, but
// some exports use "0"/"0000" placeholders — treat those as empty so a pre-laid-out (but unstarted)
// grid isn't mistaken for a draft in progress.
const hasPlayer = (p) => {
  const v = p && p.player != null ? String(p.player).trim() : '';
  return v !== '' && v !== '0' && v !== '0000';
};

// A KEEPER pre-fill vs a real draft selection. In a keeper league MFL pre-loads the kept players into
// the draft grid BEFORE the draft starts: each carries a real player id AND one bulk timestamp (the
// moment keepers were locked, identical across every keeper), tagged with a "Keeper." comment. These
// are NOT draft activity — counting them as made picks made an un-started keeper draft read as
// "in progress → on the clock → overdue" (the stale keeper timestamp became the pick-clock anchor).
// They still belong on the board (they're your kept players); they just don't mean the draft began.
const isKeeper = (p) => /keeper/i.test((p && p.comments) || '');

// The league's scheduled draft start, from MFL's CALENDAR `DRAFT_START` event (confirmed field:
// `{ type: "DRAFT_START", start_time: "<epoch-seconds>" }`). This is the authoritative start — a
// keeper/slow draft's `draftResults` often carries no startTime of its own, so without this the app
// can't tell "hasn't started yet" from "on the clock". Returns epoch-ms or null. Best-effort + cached
// (calendar is a shared, static-TTL read already used by waivers), so it adds ~no cost.
async function draftStartMs(cookie, league) {
  if (config.demoMode) return null;
  try {
    const events = await mflRepo.calendar(league, cookie);
    const ev = mfl.toArray(events).find((e) => mfl.text(e && e.type).toUpperCase() === 'DRAFT_START');
    const sec = ev ? mfl.num(ev.start_time) : null;
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : null;
  } catch (e) {
    return null;
  }
}

async function loadDraft(cookie, token, league) {
  if (config.demoMode) {
    const seed = demo.draft(league.leagueId);
    if (!seed) return null;
    // Demo has no real pick timestamps — synthesize a "last pick ~22 min ago" for a live draft so the
    // pick-clock countdown has something to render.
    const lastPickAt = seed.status === 'in_progress' ? Date.now() - 22 * 60 * 1000 : null;
    return { ...seed, picks: draftStore.list(token, league.leagueId, seed.picks), lastPickAt };
  }
  // Live: MFL draftResults. Best-effort — shapes vary, so stay defensive. Fetch the calendar's
  // scheduled DRAFT_START in parallel (authoritative start time; draftResults often omits it).
  try {
    const [units, calStartMs] = await Promise.all([
      mflRepo.draftResults(league, cookie),
      draftStartMs(cookie, league),
    ]);
    const unit = units.find((u) => String(u.unit || 'LEAGUE') === 'LEAGUE') || units[0];
    if (!unit) return null;
    const raw = mfl.toArray(unit.draftPick);
    const picks = raw
      .filter(hasPlayer)
      .map((p) => ({ round: Number(p.round), pick: Number(p.pick), franchiseId: String(p.franchise), playerId: String(p.player), timestamp: mfl.num(p.timestamp), keeper: isKeeper(p) }));
    // Only REAL (non-keeper) picks are draft activity. The most recent REAL pick's timestamp (epoch →
    // ms) is when the current on-the-clock pick's timer started — the anchor for the countdown. Keeper
    // pre-fills all share one lock timestamp and must never anchor the clock (that read as "overdue").
    const realPicks = picks.filter((p) => !p.keeper);
    const lastTs = realPicks.reduce((mx, p) => (p.timestamp && p.timestamp > mx ? p.timestamp : mx), 0);
    const lastPickAt = lastTs > 0 ? lastTs * 1000 : null;
    // If the grid includes future (empty-player) picks, we can derive order/rounds.
    const withOrder = raw.filter((p) => p.round && p.franchise);
    const order = deriveOrder(withOrder);
    const rounds = withOrder.length ? Math.max(...withOrder.map((p) => Number(p.round))) : picks.length ? Math.max(...picks.map((p) => p.round)) : 0;
    // Overlay optimistic local picks (made through the app, not yet reflected by
    // a fresh draftResults) onto the grid so a just-made pick shows immediately.
    for (const lp of draftStore.list(token, league.leagueId, [])) {
      const slot = withOrder.find((s) => Number(s.round) === lp.round && String(s.franchise) === lp.franchiseId && (!s.player || s.player === ''));
      if (slot) slot.player = lp.playerId;
      if (!picks.some((p) => p.playerId === lp.playerId)) picks.push({ round: lp.round, pick: lp.pick, franchiseId: lp.franchiseId, playerId: lp.playerId });
    }

    // Scheduled start: the calendar's DRAFT_START is authoritative; fall back to draftResults' own
    // startTime only when the calendar has no draft event. A start time in the FUTURE is authoritative:
    // the draft literally hasn't begun, even though MFL pre-populates the whole pick GRID (order +
    // traded-pick slots, and any keepers) before it starts. Without this, an unstarted draft with its
    // grid laid out read as "in progress → you're on the clock."
    const unitStartMs = unit.startTime != null && unit.startTime !== '' ? Number(unit.startTime) * 1000 : NaN;
    const startMs = calStartMs != null ? calStartMs : (Number.isFinite(unitStartMs) ? unitStartMs : null);
    const startTime = startMs != null ? new Date(startMs).toISOString() : null;
    // A REAL (non-keeper) pick means the draft has actually begun — that ALWAYS wins over the nominal
    // scheduled start. A future start only means "not begun yet" while no real pick has been made (so a
    // laid-out grid / keeper pre-fill doesn't read as live); but once a pick is in, a future/nominal
    // calendar time must not drag a live draft back to "scheduled" (that hid in-progress drafts).
    const anyRealPick = picks.some((p) => !p.keeper);
    const notStarted = startMs != null && startMs > Date.now() && !anyRealPick;
    const startedByTime = startMs != null && startMs <= Date.now();
    const nowStarted = !notStarted && (startedByTime || anyRealPick);
    const allMade = !notStarted && withOrder.length > 0 && withOrder.every(hasPlayer);
    const status = allMade ? 'complete' : nowStarted ? 'in_progress' : 'scheduled';

    // Snake vs linear is no longer assumed: use MFL's own type if it says so,
    // otherwise infer from the grid (round 2 reversed => snake, same => linear).
    // Only fall back to the dynasty-common snake default when it's indeterminable.
    const mflType = String(unit.draftType || unit.type || '').toLowerCase();
    let snake = /snake|serpentine/.test(mflType) ? true
      : /standard|linear/.test(mflType) ? false
      : inferSnake(withOrder);
    const type = snake === false ? 'Linear draft' : snake === true ? 'Snake draft' : 'Draft';
    if (snake == null) snake = true;

    return { status, type, startTime, rounds, snake, order, picks, rawSlots: withOrder, lastPickAt };
  } catch (e) {
    // A READ FAILURE (e.g. MFL rate-limited us with a 403) is NOT the same as "this league has no
    // draft". Returning null here made a transient throttle look like a draftless league, so the
    // board flickered to "No draft in this league" on a poll and back. Re-throw so the single-league
    // board propagates the error (the app keeps its last-good board); only a successful read with no
    // draft unit returns null above. The hub's per-league catch still tolerates this for its summary.
    e.transient = true;
    throw e;
  }
}

// Round-1 franchise sequence from a full pick grid (if present).
function deriveOrder(rawWithOrder) {
  const r1 = rawWithOrder.filter((p) => Number(p.round) === 1).sort((a, b) => Number(a.pick) - Number(b.pick));
  return r1.map((p) => String(p.franchise));
}

// Infer snake vs linear by comparing round 1 and round 2 franchise order.
// Returns true (snake), false (linear), or null when it can't be determined
// (fewer than two full rounds, or an irregular order from traded picks).
function inferSnake(withOrder) {
  const orderFor = (round) =>
    withOrder
      .filter((p) => Number(p.round) === round)
      .sort((a, b) => Number(a.pick) - Number(b.pick))
      .map((p) => String(p.franchise));
  const r1 = orderFor(1);
  const r2 = orderFor(2);
  if (r1.length < 2 || r2.length !== r1.length) return null;
  if (r2.join() === [...r1].reverse().join()) return true;
  if (r2.join() === r1.join()) return false;
  return null;
}

// Build the slots for a live draft that exposed a full grid, honoring made picks;
// otherwise fall back to made-picks-only.
function liveSlots(draft) {
  if (draft.rawSlots && draft.rawSlots.length) {
    return draft.rawSlots
      .slice()
      .sort((a, b) => Number(a.round) - Number(b.round) || Number(a.pick) - Number(b.pick))
      .map((p, i) => ({ overall: i + 1, round: Number(p.round), pick: Number(p.pick), franchiseId: String(p.franchise), playerId: p.player && p.player !== '' ? String(p.player) : null, keeper: isKeeper(p) }));
  }
  return buildSlots(draft);
}

function slotsFor(draft) {
  return config.demoMode ? buildSlots(draft) : liveSlots(draft);
}

async function buildPool(cookie, league, drafted, byId, enr, position) {
  // The draftable pool is everyone not on a roster in this league and not already
  // picked in this draft. For a startup that's the whole player universe; for a
  // rookie/in-season draft it's the free-agent pool. Fetch a deep list (not the
  // waiver default cap) so the value-ranked board isn't missing high-value names.
  const ids = config.demoMode ? demo.draftClass() : await waiversService.freeAgentIds(cookie, league, 2000);
  const adp = await adpLib.adpMap(cookie).catch(() => new Map());
  let pool = ids.filter((id) => !drafted.has(String(id))).map((id) => {
    const p = resolvePlayer(byId, id, enr);
    const a = adp.get(String(id));
    p.adp = a != null ? a : null;
    return p;
  });
  if (position) pool = pool.filter((p) => p.position === position);
  // Order by ADP (market-consensus draft order) — objective and owner-independent.
  // Players with a known ADP sort ahead of those without; ties and the ADP-less tail
  // fall back to dynasty value so the board is never arbitrary.
  pool.sort((a, b) => {
    if (a.adp != null && b.adp != null) return a.adp - b.adp || (b.value || 0) - (a.value || 0);
    if (a.adp != null) return -1;
    if (b.adp != null) return 1;
    return (b.value || 0) - (a.value || 0);
  });
  return pool.slice(0, 60);
}

// --- public API -------------------------------------------------------------

async function findLeague(cookie, leagueId) {
  const league = (await leaguesService.listLeagues(cookie)).find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  return league;
}

function statusOf(draft, slots) {
  // "Made" = a REAL draft pick, not a keeper pre-fill. A keeper league's grid is full of kept players
  // before the draft starts; counting those as made picks flipped an un-started draft to "in progress".
  const anyMade = slots.some((s) => s.playerId && !s.keeper);
  const anyOpen = slots.some((s) => !s.playerId);
  // A future start time means the draft hasn't begun — never on the clock yet — as long as no REAL
  // pick has been made. Keeper leagues pre-load kept players (and MFL lays out the grid) before the
  // scheduled start, and those must NOT flip a not-yet-started draft to "in progress". But a real
  // (non-keeper) pick means it HAS begun, so a future/nominal start must not drag a live draft back to
  // "scheduled" (that mislabeled in-progress drafts and hid them from Home).
  if (draft.startTime && Date.parse(draft.startTime) > Date.now() && !anyMade) return 'scheduled';
  // Respect an explicit "scheduled" until the first pick is made...
  if (draft.status === 'scheduled' && !anyMade) return 'scheduled';
  // ...otherwise derive from the board so it flips to complete when full.
  if (slots.length && !anyOpen) return 'complete';
  if (anyMade) return 'in_progress';
  return draft.status || 'scheduled';
}

function onClockSlot(status, slots) {
  return status === 'in_progress' ? slots.find((s) => !s.playerId) || null : null;
}

// A default clock so the DEMO draft shows a live countdown without a real league behind it (8h per
// pick, paused midnight–8am ET). Live leagues get their real clock auto-detected from MFL's `league`
// export (draftLimitHours / draftTimerSusp), so this default is demo-only.
const DEMO_CLOCK = { pickHours: 8, pause: { start: 0, end: 8 }, source: 'demo' };

// The current pick's countdown, from the last pick's timestamp + the league's clock config. Only for
// a live draft with a known clock; null otherwise (the screen then just shows whose turn it is).
function buildPickClock(draft, status, clockConfig) {
  if (status !== 'in_progress') return null;
  const cfg = clockConfig || (config.demoMode ? DEMO_CLOCK : null);
  if (!cfg) return null;
  // The current pick's timer started at the previous pick's timestamp; for pick 1 (nothing drafted
  // yet) it started at the draft's start time. If picks HAVE been made but MFL gave no timestamp, we
  // can't time it accurately — return null (show whose turn it is) rather than anchor to the stale
  // draft start and read a false "overdue".
  const anyPicks = (draft.picks || []).some((p) => !p.keeper); // keepers aren't real picks (see isKeeper)
  const clockStart = draft.lastPickAt || (!anyPicks && draft.startTime ? Date.parse(draft.startTime) : null);
  if (!clockStart) return null;
  const st = draftClockLib.pickClockState(clockStart, cfg.pickHours, cfg.pause, Date.now());
  if (!st) return null;
  return {
    deadline: new Date(st.deadlineMs).toISOString(),
    remainingMs: st.remainingMs,
    paused: st.paused,
    overdue: st.overdue,
    pickHours: cfg.pickHours,
    pause: cfg.pause || null,
    startedAt: clockStart ? new Date(clockStart).toISOString() : null,
    source: cfg.source || 'mfl', // 'mfl' (auto-detected), 'manual' (owner override), or 'demo'
    configured: (cfg.source || 'mfl') !== 'demo', // a real clock (MFL or manual), not the demo default
  };
}

// Is a league's free agency / waiver pool live yet? A player isn't truly a free agent until the draft
// has been HELD — before that (a startup league, or an offseason rookie draft that's scheduled or
// mid-way) the whole player universe reads as "unrostered", which would falsely surface watched players
// as claimable. The calendar's DRAFT_START is a direct signal a draft exists for this league, so we
// consult it too — a FUTURE draft closes FA even if MFL hasn't laid out the grid yet (that was the bug:
// a pre-draft league falsely highlighting watched free agents). Open only once a draft is complete, or
// when there's no draft on file at all (an established in-season league). A known but unreadable draft
// stays CLOSED (erring toward "not open" only delays a real alert — the 5-min memo self-heals — vs. the
// worse failure of flagging the whole pre/mid-draft pool as claimable).
function freeAgencyOpen(cookie, token, league) {
  return draftOpenMemo.get(`${cookie || ''}:${league.leagueId}`, async () => {
    const draft = await loadDraft(cookie, token, league).catch(() => null);
    // Prefer the loaded draft's resolved start; if the grid didn't load at all, read the calendar
    // directly so a future draft still closes FA.
    const startMs = draft && draft.startTime ? Date.parse(draft.startTime)
      : await draftStartMs(cookie, league).catch(() => null);
    if (startMs != null && startMs > Date.now()) return false; // a scheduled (future) draft → not open
    if (draft) {
      const st = statusOf(draft, slotsFor(draft));
      if (st === 'complete') return true; // draft held → FA/waivers open
      if (st === 'scheduled' || st === 'in_progress') return false; // pending / underway → not open
    }
    if (startMs != null) return false; // a known (past) draft we couldn't confirm complete → stay closed
    return true; // no draft on file anywhere → established in-season league → FA open
  });
}

// All leagues' draft state — for "which drafts are scheduled / live / my turn".
async function getOverview(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const drafts = await Promise.all(
    leagues.map(async (league) => {
      try {
        const draft = await loadDraft(cookie, token, league);
        if (!draft) return { leagueId: league.leagueId, name: league.name, status: 'none' };
        const slots = slotsFor(draft);
        const status = statusOf(draft, slots);
        const clock = onClockSlot(status, slots);
        const myNext = slots.find((s) => !s.playerId && s.franchiseId === league.franchiseId);
        const myOnClock = !!(clock && clock.franchiseId === league.franchiseId);
        // When it's MY pick, attach the live pick-clock (deadline + time left) so callers — Home and the
        // "clock running low" push — can nudge before it expires into an autopick. Only computed on my
        // turn (one extra, cached league-settings read), so the overview stays a light fan-out.
        let myClock = null;
        if (myOnClock) {
          const clockConfig = config.demoMode ? null : await leagueFormat.draftClockConfig(cookie, league).catch(() => null);
          const pc = buildPickClock(draft, status, clockConfig);
          if (pc) myClock = { deadline: pc.deadline, remainingMs: pc.remainingMs, paused: pc.paused, overdue: pc.overdue, pickHours: pc.pickHours, round: clock.round, pick: clock.pick };
        }
        return {
          leagueId: league.leagueId,
          name: league.name,
          type: draft.type,
          status,
          startTime: draft.startTime || null,
          myOnClock,
          myClock,
          myNextPick: myNext ? { overall: myNext.overall, round: myNext.round, pick: myNext.pick } : null,
          picksMade: slots.filter((s) => s.playerId && !s.keeper).length,
        };
      } catch (e) {
        return { leagueId: league.leagueId, name: league.name, status: 'none' };
      }
    })
  );
  return {
    drafts,
    summary: {
      live: drafts.filter((d) => d.status === 'in_progress').length,
      scheduled: drafts.filter((d) => d.status === 'scheduled').length,
      onClock: drafts.filter((d) => d.myOnClock).length,
    },
  };
}

// Shared situational context both draft screens open with: the player index + format-aware enrichment,
// the league's dynasty context, and my team's roster summary — all fail-soft so a hiccup never blanks
// the board. (getLeague and getDraftList used to inline this identical fan-out.)
async function loadDraftContext(cookie, league) {
  const [byId, enr, context, teamSummary] = await Promise.all([
    playersLib.load(cookie),
    enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie),
    leagueContext.build(cookie, league).catch(() => null),
    rosterService.getRoster(cookie, league.leagueId).then((r) => r.summary).catch(() => null),
  ]);
  return { byId, enr, context, teamSummary };
}

// The `context` payload both draft screens return: the league context with my team's dynasty read
// folded in (or null when there's no context).
function draftContextPayload(context, teamSummary) {
  if (!context) return null;
  return {
    ...context,
    team: teamSummary
      ? { outlook: teamSummary.outlook || null, coreAge: teamSummary.coreAge != null ? teamSummary.coreAge : null, avgAge: teamSummary.avgAge != null ? teamSummary.avgAge : null, strengthLabel: teamSummary.strengthLabel || null }
      : null,
  };
}

// One league's full draft view: board, my picks, on the clock, available pool.
async function getLeague(cookie, token, leagueId, { position } = {}) {
  const league = await findLeague(cookie, leagueId);
  const draft = await loadDraft(cookie, token, league);
  if (!draft) return { leagueId: league.leagueId, name: league.name, status: 'none' };

  // Scoring + starting-lineup context (superflex/PPR/TE-premium + how many of each you start) and my
  // team's dynasty read (win-now/ascending, core age, strength) — the situational info that changes a
  // draft decision.
  const { byId, enr, context, teamSummary } = await loadDraftContext(cookie, league);
  const slots = slotsFor(draft).map((s) => ({ ...s, player: s.playerId ? resolvePlayer(byId, s.playerId, enr) : null }));
  const status = statusOf(draft, slots);
  const clock = onClockSlot(status, slots);
  const drafted = new Set(slots.filter((s) => s.playerId).map((s) => s.playerId));
  const available = await buildPool(cookie, league, drafted, byId, enr, position);
  // Overlay personal tags so the board can highlight your Targets and dim your Avoids.
  for (const p of available) p.tag = playerTags.get(token, p.id) || null;

  // Clock config: auto-detected from MFL's `league` export (draftLimitHours / draftTimerSusp) — no
  // owner input needed. Demo falls back to the demo default (see buildPickClock).
  const clockConfig = config.demoMode ? null : await leagueFormat.draftClockConfig(cookie, league).catch(() => null);
  const pickClock = buildPickClock(draft, status, clockConfig);

  return {
    leagueId: league.leagueId,
    name: league.name,
    type: draft.type,
    snake: draft.snake != null ? draft.snake : null,
    status,
    startTime: draft.startTime || null,
    rounds: draft.rounds || null,
    onClock: clock ? { franchiseId: clock.franchiseId, mine: clock.franchiseId === league.franchiseId, overall: clock.overall, round: clock.round, pick: clock.pick } : null,
    // The current pick's countdown (or null when there's no clock configured / draft not live). Also
    // return the stored config + whether one is set, so the screen can offer to set/edit it.
    pickClock,
    clockConfig: clockConfig || null,
    lastPickAt: draft.lastPickAt ? new Date(draft.lastPickAt).toISOString() : null,
    board: slots,
    myPicks: slots.filter((s) => s.franchiseId === league.franchiseId),
    available,
    context: draftContextPayload(context, teamSummary),
  };
}

// Make a pick when on the clock. `comments` is optional — MFL's live_draft accepts a note that's
// "meant for email drafts" (shown in the draft log, not the live room); ignored in demo.
async function makePick(cookie, token, leagueId, playerId, comments) {
  const league = await findLeague(cookie, leagueId);
  const draft = await loadDraft(cookie, token, league);
  if (!draft) throwBad('This league has no draft.');
  const slots = slotsFor(draft);
  const status = statusOf(draft, slots);
  const clock = onClockSlot(status, slots);
  if (!clock) throwBad('The draft is not currently in progress.');
  if (clock.franchiseId !== league.franchiseId) throwBad('It is not your pick.');
  const drafted = new Set(slots.filter((s) => s.playerId).map((s) => s.playerId));
  if (drafted.has(String(playerId))) throwBad('That player is already drafted.');

  if (!config.demoMode) {
    // Submit the pick to MFL's live-draft engine — the Misc command `live_draft`
    // (year/live_draft?CMD=DRAFT&PLAYER_PICK&ROUND&PICK), owner-accessible, confirmed against MFL's
    // Misc API reference. ROUND/PICK must match the current On-The-Clock slot (validated above);
    // MFL rejects a stale/taken pick and its error is surfaced. Works for live AND slow/email drafts.
    const note = typeof comments === 'string' ? comments.trim().slice(0, 255) : '';
    await mfl.miscRequest('live_draft', {
      host: league.host,
      cookie,
      L: league.leagueId,
      CMD: 'DRAFT',
      PLAYER_PICK: String(playerId),
      ROUND: clock.round,
      PICK: clock.pick,
      COMMENTS: note || undefined, // optional note for the draft log ("meant for email drafts")
      JSON: 1,
    });
    // The pick lands on my roster and the draft grid — drop this league's cached reads so the board
    // and roster reflect it immediately (a fresh draftResults may lag a beat).
    rosterService.invalidate(cookie, leagueId);
    mfl.invalidateLeague(cookie, leagueId);
  }
  // Record the pick locally (both modes): demo has no backing draft engine; live overlays it onto
  // the grid (loadDraft merges draftStore picks) until a fresh draftResults read catches up.
  draftStore.add(token, leagueId, config.demoMode ? demo.draft(leagueId).picks : [], {
    round: clock.round,
    pick: clock.pick,
    franchiseId: league.franchiseId,
    playerId: String(playerId),
  });
  return getLeague(cookie, token, leagueId);
}

function throwBad(msg) {
  const err = new Error(msg);
  err.status = 400;
  throw err;
}

// Current-year (upcoming-draft) picks each franchise still holds, as tradeable assets — the
// picks for THIS season's draft that hasn't happened yet. They live in the draft order, not
// MFL's futureDraftPicks export, which is why the trade builder was missing them. Tokenized
// as DP_<round-1>_<pick-1> (both zero-based) to match MFL's trade API and picksLib.labelForToken.
// Live uses MFL's own per-slot round/pick/franchise (accurate even after pick trades); demo
// derives from the seeded draft order. Returns { franchiseId: [{ token, label, round, pick }] }.
async function upcomingPicksByFranchise(cookie, token, league) {
  const group = (slots) => {
    const byFr = {};
    for (const s of slots) {
      if (!s.round || !s.pick || !s.franchiseId) continue;
      const tok = `DP_${s.round - 1}_${s.pick - 1}`;
      const label = `${config.season} ${s.round}.${String(s.pick).padStart(2, '0')}`;
      (byFr[String(s.franchiseId)] || (byFr[String(s.franchiseId)] = [])).push({ token: tok, label, round: s.round, pick: s.pick, year: config.season });
    }
    return byFr;
  };

  if (config.demoMode) {
    const draft = await loadDraft(cookie, token, league).catch(() => null);
    if (!draft) return {};
    const open = buildSlots(draft).filter((s) => !s.playerId).map((s) => ({ round: s.round, pick: s.pick, franchiseId: s.franchiseId }));
    return group(open);
  }
  // Live: read the draft grid; unpicked slots (empty player) carry their current owner.
  try {
    const units = await mflRepo.draftResults(league, cookie);
    const unit = units.find((u) => String(u.unit || 'LEAGUE') === 'LEAGUE') || units[0];
    if (!unit) return {};
    const open = mfl.toArray(unit.draftPick)
      .filter((p) => (!p.player || p.player === '') && p.round && p.pick && p.franchise)
      .map((p) => ({ round: Number(p.round), pick: Number(p.pick), franchiseId: String(p.franchise) }));
    return group(open);
  } catch (e) {
    return {};
  }
}

// Every draft pick YOU own across all your leagues — the current-year draft picks (still in the
// draft grid) plus future-season picks (MFL's futureDraftPicks). Read-only: a value-tagged
// inventory grouped by year, so you can see your pick capital at a glance and which picks were
// acquired in a trade (and from whom). Trading picks stays on the trade desk.
async function getPickInventory(cookie, token) {
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const per = await Promise.all(
    leagues.map(async (league) => {
      const rawFid = String(league.franchiseId);
      const myFid = rawFid.padStart(4, '0');
      const base = { leagueId: league.leagueId, leagueName: league.name };
      // Authoritative source: MFL's `assets` export (post-trade ownership + owner names in the
      // description). Falls back to composing draftResults (current) + futureDraftPicks (future).
      const [assetsMap, future, upcomingMap, names] = await Promise.all([
        picksLib.assetsByFranchise(cookie, league).catch(() => null),
        picksLib.franchisePicks(cookie, league).catch(() => []),
        upcomingPicksByFranchise(cookie, token, league).catch(() => ({})),
        leaguesService.franchiseNames(cookie, league).catch(() => new Map()),
      ]);

      const mine = assetsMap && (assetsMap[myFid] || assetsMap[rawFid]);
      if (mine) {
        return mine.map((p) => {
          const acquired = p.kind === 'future' && p.originalOwner && String(p.originalOwner).padStart(4, '0') !== myFid;
          return {
            ...base, token: p.token, label: p.label, year: p.year, round: p.round, pick: p.pick,
            value: picksLib.value(p.label),
            kind: p.kind === 'future' ? 'future' : 'upcoming',
            acquiredFrom: acquired ? (p.from || `Franchise ${p.originalOwner}`) : null,
          };
        });
      }

      // Fallback (incl. demo): current-year (draft grid) then future-season (futureDraftPicks).
      const upcoming = upcomingMap[rawFid] || [];
      const rows = upcoming.map((p) => ({
        ...base, token: p.token, label: p.label, year: p.year, round: p.round, pick: p.pick || null,
        value: picksLib.value(p.label), kind: 'upcoming', acquiredFrom: null,
      }));
      for (const p of future) {
        // FP_<originalOwner>_<year>_<round>: a pick whose original owner isn't me was acquired.
        const m = /^FP_(\d+)_/.exec(String(p.token));
        const owner = m ? String(m[1]).padStart(4, '0') : myFid;
        const acquired = owner !== myFid;
        rows.push({
          ...base, token: p.token, label: p.label, year: p.year, round: p.round, pick: null,
          value: picksLib.value(p.label), kind: 'future',
          acquiredFrom: acquired ? (names.get(owner) || names.get(String(Number(owner))) || `Franchise ${owner}`) : null,
        });
      }
      return rows;
    })
  );
  const picks = per.flat().sort((a, b) => (a.year || 0) - (b.year || 0) || (a.round || 0) - (b.round || 0) || (b.value || 0) - (a.value || 0));
  const byYear = [];
  for (const p of picks) {
    let g = byYear.find((x) => x.year === p.year);
    if (!g) { g = { year: p.year, picks: [], value: 0 }; byYear.push(g); }
    g.picks.push(p);
    g.value += p.value || 0;
  }
  const summary = {
    total: picks.length,
    totalValue: picks.reduce((s, p) => s + (p.value || 0), 0),
    firsts: picks.filter((p) => p.round === 1).length,
    acquired: picks.filter((p) => p.acquiredFrom).length,
    leagues: leagues.length,
  };
  return { summary, byYear, picks };
}

// Read MFL's own `myDraftList` export, so a live owner who set a list on MFL's site sees it here on
// first open. Confirmed shape (live sample): { myDraftList: { player: [{ id, order }] } } — `order`
// is the authoritative 0-based rank, so sort by it rather than trusting array order. Null on any
// miss (we then fall back to an empty local list).
async function liveDraftListIds(cookie, league) {
  try {
    const res = await mfl.exportRequest('myDraftList', { host: league.host, cookie, L: league.leagueId });
    return mfl.toArray(res && res.myDraftList && res.myDraftList.player)
      .filter((p) => p && p.id != null && p.id !== '')
      .sort((a, b) => (mfl.num(a.order) || 0) - (mfl.num(b.order) || 0))
      .map((p) => String(p.id));
  } catch (e) {
    return null;
  }
}

// The owner's "My Draft List" for one league — a ranked shortlist that (pre-draft) narrows the
// pool to who they actually want, and (during a slow/live draft) drives MFL's auto-pick: MFL takes
// the top still-available player from this list when the owner's clock fires. Returns the ranked
// list (each flagged `drafted` if already gone), the `nextUp` (top available — who MFL would pick
// for you now), on-the-clock state, and a value-ranked `available` pool to add from (minus anyone
// drafted, rostered, or already on the list). `position` filters the add-pool.
async function getDraftList(cookie, token, leagueId, { position } = {}) {
  const league = await findLeague(cookie, leagueId);
  const { byId, enr, context, teamSummary } = await loadDraftContext(cookie, league);
  const draft = await loadDraft(cookie, token, league).catch(() => null);
  const slots = draft ? slotsFor(draft).map((s) => ({ ...s, player: s.playerId ? resolvePlayer(byId, s.playerId, enr) : null })) : [];
  const status = draft ? statusOf(draft, slots) : 'none';
  const clock = draft ? onClockSlot(status, slots) : null;
  const drafted = new Set(slots.filter((s) => s.playerId).map((s) => String(s.playerId)));

  // Our stored order is the source of truth (we write it via myDraftList). Live: if we've never
  // stored one, try to seed from MFL's own list a first time.
  let ids = draftListStore.get(token, leagueId);
  if (ids == null && !config.demoMode) ids = await liveDraftListIds(cookie, league);
  ids = ids || [];

  const list = ids.map((id, i) => {
    const p = resolvePlayer(byId, id, enr);
    return {
      rank: i + 1, id: String(id), name: p.name, position: p.position, team: p.team,
      value: enr.value(id), tag: playerTags.get(token, id) || null, drafted: drafted.has(String(id)),
    };
  });
  // "Next up" = the highest-ranked player still on the board — the one MFL would auto-pick for you.
  const nextUp = list.find((p) => !p.drafted) || null;

  // A value-ranked pool to add from, minus anyone drafted, rostered, or already on the list.
  const onList = new Set(ids.map(String));
  const available = (await buildPool(cookie, league, drafted, byId, enr, position).catch(() => []))
    .filter((p) => !onList.has(String(p.id)))
    .map((p) => ({ ...p, tag: playerTags.get(token, p.id) || null }));

  return {
    leagueId: league.leagueId,
    name: league.name,
    status,
    onClock: clock ? { mine: clock.franchiseId === league.franchiseId, round: clock.round, pick: clock.pick, overall: clock.overall } : null,
    count: list.length,
    draftedCount: list.filter((p) => p.drafted).length,
    nextUp,
    list,
    available,
    context: draftContextPayload(context, teamSummary),
  };
}

// Replace the whole ranked list for a league. Live: pushes to MFL via `myDraftList` (overwrites the
// owner's prior list) then mirrors locally; demo: local store only. Returns the refreshed view.
async function saveDraftList(cookie, token, leagueId, ids) {
  const league = await findLeague(cookie, leagueId);
  const clean = [...new Set((ids || []).map((x) => String(x)).filter(Boolean))];
  if (!config.demoMode) {
    // myDraftList overwrites the owner's prior list; surfaces MFL's own error detail on failure.
    await mfl.importRequest('myDraftList', { host: league.host, cookie, L: league.leagueId, PLAYERS: clean.join(',') });
  }
  draftListStore.set(token, leagueId, clean);
  return getDraftList(cookie, token, leagueId);
}

module.exports = { getOverview, getLeague, makePick, upcomingPicksByFranchise, freeAgencyOpen, getPickInventory, getDraftList, saveDraftList };
