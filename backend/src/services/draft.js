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
const playersLib = require('../lib/players');
const picksLib = require('../lib/picks');
const adpLib = require('../lib/adp');
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
  for (const p of draft.picks || []) made.set(`${p.round}-${p.pick}`, p.playerId);

  if (!order.length || !rounds) {
    return (draft.picks || [])
      .slice()
      .sort((a, b) => a.round - b.round || a.pick - b.pick)
      .map((p, i) => ({ overall: i + 1, round: p.round, pick: p.pick, franchiseId: p.franchiseId, playerId: p.playerId || null }));
  }

  const slots = [];
  let overall = 0;
  for (let r = 1; r <= rounds; r++) {
    const roundOrder = draft.snake && r % 2 === 0 ? [...order].reverse() : order;
    roundOrder.forEach((franchiseId, i) => {
      overall += 1;
      slots.push({ overall, round: r, pick: i + 1, franchiseId, playerId: made.get(`${r}-${i + 1}`) || null });
    });
  }
  return slots;
}

// --- data loaders (demo vs live) --------------------------------------------

async function loadDraft(cookie, token, league) {
  if (config.demoMode) {
    const seed = demo.draft(league.leagueId);
    if (!seed) return null;
    return { ...seed, picks: draftStore.list(token, league.leagueId, seed.picks) };
  }
  // Live: MFL draftResults. Best-effort — shapes vary, so stay defensive.
  try {
    const units = await mflRepo.draftResults(league, cookie);
    const unit = units.find((u) => String(u.unit || 'LEAGUE') === 'LEAGUE') || units[0];
    if (!unit) return null;
    const raw = mfl.toArray(unit.draftPick);
    const picks = raw
      .filter((p) => p.player && p.player !== '')
      .map((p) => ({ round: Number(p.round), pick: Number(p.pick), franchiseId: String(p.franchise), playerId: String(p.player) }));
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

    const startTime = unit.startTime ? new Date(Number(unit.startTime) * 1000).toISOString() : null;
    const nowStarted = raw.some((p) => p.player && p.player !== '') || picks.length > 0;
    const allMade = withOrder.length ? withOrder.every((p) => p.player && p.player !== '') : false;
    const status = allMade ? 'complete' : nowStarted ? 'in_progress' : startTime ? 'scheduled' : 'scheduled';

    // Snake vs linear is no longer assumed: use MFL's own type if it says so,
    // otherwise infer from the grid (round 2 reversed => snake, same => linear).
    // Only fall back to the dynasty-common snake default when it's indeterminable.
    const mflType = String(unit.draftType || unit.type || '').toLowerCase();
    let snake = /snake|serpentine/.test(mflType) ? true
      : /standard|linear/.test(mflType) ? false
      : inferSnake(withOrder);
    const type = snake === false ? 'Linear draft' : snake === true ? 'Snake draft' : 'Draft';
    if (snake == null) snake = true;

    return { status, type, startTime, rounds, snake, order, picks, rawSlots: withOrder };
  } catch (e) {
    return null;
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
      .map((p, i) => ({ overall: i + 1, round: Number(p.round), pick: Number(p.pick), franchiseId: String(p.franchise), playerId: p.player && p.player !== '' ? String(p.player) : null }));
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
  const anyMade = slots.some((s) => s.playerId);
  const anyOpen = slots.some((s) => !s.playerId);
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

// Is a league's free agency / waiver pool live yet? A player isn't truly a free agent
// until the draft has been HELD — before that (a startup league, or an offseason rookie
// draft that's scheduled or mid-way), the whole player universe reads as "unrostered",
// which would falsely surface watched players as claimable. Open only once the draft is
// complete; a league with no draft on file is an established/in-season league where FA is
// already open. Best-effort: a draft-read failure defaults to open so we don't hide real
// alerts for the common (already-drafted) case.
function freeAgencyOpen(cookie, token, league) {
  return draftOpenMemo.get(`${cookie || ''}:${league.leagueId}`, async () => {
    try {
      const draft = await loadDraft(cookie, token, league);
      if (!draft) return true;
      return statusOf(draft, slotsFor(draft)) === 'complete';
    } catch (e) {
      return true;
    }
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
        return {
          leagueId: league.leagueId,
          name: league.name,
          type: draft.type,
          status,
          startTime: draft.startTime || null,
          myOnClock: !!(clock && clock.franchiseId === league.franchiseId),
          myNextPick: myNext ? { overall: myNext.overall, round: myNext.round, pick: myNext.pick } : null,
          picksMade: slots.filter((s) => s.playerId).length,
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

// One league's full draft view: board, my picks, on the clock, available pool.
async function getLeague(cookie, token, leagueId, { position } = {}) {
  const league = await findLeague(cookie, leagueId);
  const draft = await loadDraft(cookie, token, league);
  if (!draft) return { leagueId: league.leagueId, name: league.name, status: 'none' };

  const [byId, enr] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie)]);
  const slots = slotsFor(draft).map((s) => ({ ...s, player: s.playerId ? resolvePlayer(byId, s.playerId, enr) : null }));
  const status = statusOf(draft, slots);
  const clock = onClockSlot(status, slots);
  const drafted = new Set(slots.filter((s) => s.playerId).map((s) => s.playerId));
  const available = await buildPool(cookie, league, drafted, byId, enr, position);
  // Overlay personal tags so the board can highlight your Targets and dim your Avoids.
  for (const p of available) p.tag = playerTags.get(token, p.id) || null;

  return {
    leagueId: league.leagueId,
    name: league.name,
    type: draft.type,
    snake: draft.snake != null ? draft.snake : null,
    status,
    startTime: draft.startTime || null,
    rounds: draft.rounds || null,
    onClock: clock ? { franchiseId: clock.franchiseId, mine: clock.franchiseId === league.franchiseId, overall: clock.overall, round: clock.round, pick: clock.pick } : null,
    board: slots,
    myPicks: slots.filter((s) => s.franchiseId === league.franchiseId),
    available,
  };
}

// Make a pick when on the clock.
async function makePick(cookie, token, leagueId, playerId) {
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
    // NOTE: a live make-a-pick API DOES exist — it's the *Misc* command `live_draft`
    // (`year/live_draft?CMD=DRAFT&PLAYER_PICK&ROUND&PICK`, owner-accessible), not an
    // `import?TYPE=` write, which is why an earlier audit pass concluded it was absent
    // (see docs/MFL_API_AUDIT.md §2 + ROADMAP "Owner writes unlocked…"). Wiring it is a
    // planned change; until it's built and verified against a live draft, keep the honest
    // 501 rather than firing an unverified write at a real league. The board stays fully
    // readable; only the in-app pick action is deferred.
    const err = new Error(
      'In-app drafting isn’t available for live leagues yet — make your pick in the MyFantasyLeague draft room. It’ll show here once MFL processes it.'
    );
    err.status = 501; // Not Implemented (planned: live_draft?CMD=DRAFT)
    throw err;
  }
  draftStore.add(token, leagueId, config.demoMode ? demo.draft(leagueId).picks : [], {
    round: clock.round,
    pick: clock.pick,
    franchiseId: league.franchiseId,
    playerId: String(playerId),
  });
  // The pick lands on my roster and updates the draft board — drop this league's
  // cached roster + reads so the board and roster reflect it immediately.
  if (!config.demoMode) rosterService.invalidate(cookie, leagueId);
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
      const myFid = String(league.franchiseId).padStart(4, '0');
      const [future, upcomingMap, names] = await Promise.all([
        picksLib.franchisePicks(cookie, league).catch(() => []),
        upcomingPicksByFranchise(cookie, token, league).catch(() => ({})),
        leaguesService.franchiseNames(cookie, league).catch(() => new Map()),
      ]);
      const upcoming = upcomingMap[String(league.franchiseId)] || [];
      const base = { leagueId: league.leagueId, leagueName: league.name };
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

// Best-effort read of MFL's own `myDraftList` export, so a live owner who set a list on MFL's
// site sees it here on first open. Undocumented shape to us, so stay tolerant; null on any miss
// (we then fall back to an empty local list).
async function liveDraftListIds(cookie, league) {
  try {
    const res = await mfl.exportRequest('myDraftList', { host: league.host, cookie, L: league.leagueId });
    const root = (res && (res.myDraftList || res.myDraftPool || res.draftList)) || null;
    const players = root && (root.player || root.players || root.playerId);
    return mfl.toArray(players).map((p) => String((p && (p.id || p.player)) || p)).filter((s) => s && s !== '[object Object]');
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
  const [byId, enr] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie)]);
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
