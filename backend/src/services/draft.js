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
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');
const playersLib = require('../lib/players');
const leaguesService = require('./leagues');
const waiversService = require('./waivers');
const draftStore = require('../store/draft');

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
  const made = new Map();
  for (const p of draft.picks || []) made.set(`${p.round}-${p.franchiseId}`, p.playerId);

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
      slots.push({ overall, round: r, pick: i + 1, franchiseId, playerId: made.get(`${r}-${franchiseId}`) || null });
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
    const res = await mfl.exportRequest('draftResults', { host: league.host, cookie, L: league.leagueId });
    const units = mfl.toArray(res && res.draftResults && res.draftResults.draftUnit);
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
    return { status, type: 'Draft', startTime, rounds, snake: true, order, picks, rawSlots: withOrder };
  } catch (e) {
    return null;
  }
}

// Round-1 franchise sequence from a full pick grid (if present).
function deriveOrder(rawWithOrder) {
  const r1 = rawWithOrder.filter((p) => Number(p.round) === 1).sort((a, b) => Number(a.pick) - Number(b.pick));
  return r1.map((p) => String(p.franchise));
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
  const ids = config.demoMode ? demo.draftClass() : await waiversService.freeAgentIds(cookie, league);
  let pool = ids.filter((id) => !drafted.has(String(id))).map((id) => resolvePlayer(byId, id, enr));
  if (position) pool = pool.filter((p) => p.position === position);
  pool.sort((a, b) => (b.value || 0) - (a.value || 0));
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
  if (draft.status) return draft.status;
  const anyMade = slots.some((s) => s.playerId);
  const anyOpen = slots.some((s) => !s.playerId);
  if (anyMade && !anyOpen) return 'complete';
  if (anyMade) return 'in_progress';
  return 'scheduled';
}

function onClockSlot(status, slots) {
  return status === 'in_progress' ? slots.find((s) => !s.playerId) || null : null;
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
          myNextPick: myNext ? { overall: myNext.overall, round: myNext.round } : null,
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

  const [byId, enr] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(await leagueFormat.format(cookie, league))]);
  const slots = slotsFor(draft).map((s) => ({ ...s, player: s.playerId ? resolvePlayer(byId, s.playerId, enr) : null }));
  const status = statusOf(draft, slots);
  const clock = onClockSlot(status, slots);
  const drafted = new Set(slots.filter((s) => s.playerId).map((s) => s.playerId));
  const available = await buildPool(cookie, league, drafted, byId, enr, position);

  return {
    leagueId: league.leagueId,
    name: league.name,
    type: draft.type,
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
    try {
      await mfl.importRequest('draftPick', { host: league.host, cookie, L: league.leagueId, FRANCHISE: league.franchiseId, PLAYER: String(playerId) });
    } catch (e) {
      const err = new Error(`MFL rejected the pick: ${e.message}`);
      err.status = 502;
      throw err;
    }
  }
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

module.exports = { getOverview, getLeague, makePick };
