'use strict';

// Shared NFL-schedule helpers used by multiple services (lineups, roster, ...).
// Kept in one place so bye-week logic is consistent everywhere.

const mfl = require('./mfl');
const playersLib = require('./players');

// --- current NFL week detection ---------------------------------------------
// The active week is derived from MFL, not hand-set. MFL's nflSchedule export,
// called WITHOUT a W, returns the current week's matchups with a `week`
// attribute — that's the league-agnostic "what week is it" signal. We cache it
// process-wide (refreshed hourly) so it costs one call, not one per request.
// An explicit MFL_WEEK env var still overrides (handy for testing or forcing a
// week). Returns a 1–18 week number, or null when it can't be determined
// (true offseason, or MFL unreachable with no cached value).
let weekCache = { week: null, at: 0 };
const WEEK_TTL_MS = 60 * 60 * 1000; // 1h

async function currentWeek(cookie) {
  const override = Number(process.env.MFL_WEEK);
  if (override >= 1 && override <= 18) return override;

  const now = Date.now();
  if (weekCache.week != null && now - weekCache.at < WEEK_TTL_MS) return weekCache.week;

  try {
    const res = await mfl.exportRequest('nflSchedule', { cookie }); // no W -> current week
    const w = Number(res && res.nflSchedule && res.nflSchedule.week);
    if (w >= 1 && w <= 18) {
      weekCache = { week: w, at: now };
      console.log(`[currentWeek] detected week ${w} from MFL`);
      return w;
    }
    // A response with no in-range week means the season isn't active.
    weekCache = { week: null, at: now };
    return null;
  } catch (e) {
    console.log(`[currentWeek] detection failed: ${e.message}`);
    return weekCache.week; // keep last-good if we have one, else null
  }
}

// Reset the cache (used by tests to force re-detection).
function _resetWeekCache() {
  weekCache = { week: null, at: 0 };
}

// One week's NFL matchups, cached (the schedule is static once set), shared by
// byeMap and upcomingOpponents so a profile view doesn't refetch the same week.
const scheduleCache = new Map(); // week -> { at, matchups }
const SCHED_TTL_MS = 6 * 60 * 60 * 1000;
async function scheduleMatchups(cookie, week) {
  const c = scheduleCache.get(week);
  if (c && Date.now() - c.at < SCHED_TTL_MS) return c.matchups;
  const res = await mfl.exportRequest('nflSchedule', { cookie, W: week });
  const matchups = mfl.toArray(res && res.nflSchedule && res.nflSchedule.matchup);
  scheduleCache.set(week, { at: Date.now(), matchups });
  return matchups;
}

// Team bye weeks for a given week: MFL's nflSchedule lists that week's matchups;
// any NFL team not appearing is on bye. We compare against the full team set
// derived from the loaded player pool (same MFL team codes), so a bye sidelines
// skill players, kickers, and defenses alike. Returns { [TEAM]: week }.
const byeCache = new Map(); // week -> { at, byes }
async function byeMap(cookie, week) {
  if (!week) return {};
  const cached = byeCache.get(week);
  if (cached && Date.now() - cached.at < SCHED_TTL_MS) return cached.byes;
  try {
    const matchups = await scheduleMatchups(cookie, week);
    const playing = new Set();
    for (const m of matchups) {
      for (const t of mfl.toArray(m && m.team)) {
        if (t && t.id) playing.add(String(t.id).toUpperCase());
      }
    }
    if (!playing.size) return {}; // transient/empty — don't cache
    const byId = await playersLib.load(cookie);
    // Derived by scanning the full player pool; the result (a few teams on bye) is
    // stable for the week, so cache it and skip the scan on later reads this week.
    const byes = {};
    for (const p of byId.values()) {
      const team = String(p.team || '').toUpperCase();
      if (team && team !== 'FA' && !playing.has(team)) byes[team] = week;
    }
    byeCache.set(week, { at: Date.now(), byes });
    return byes;
  } catch (e) {
    console.log(`[byeMap] week=${week} failed: ${e.message}`);
    return {};
  }
}

// Injury/status map for a week: { [playerId]: 'OUT' | 'QUESTIONABLE' | ... }.
async function injuryMap(cookie, week) {
  if (!week) return {}; // no active week (offseason) -> nothing to fetch
  try {
    const res = await mfl.exportRequest('injuries', { cookie, W: week });
    const list = mfl.toArray(res && res.injuries && res.injuries.injury);
    const map = {};
    for (const i of list) map[String(i.id)] = String(i.status || '').toUpperCase();
    return map;
  } catch (e) {
    console.log(`[injuryMap] week=${week} failed: ${e.message}`);
    return {};
  }
}

// The next NFL kickoff at or after now for a given week, as an ISO string —
// i.e. the soonest moment a lineup starts locking. MFL's nflSchedule carries a
// `kickoff` epoch per matchup. Returns null if the week or times aren't available.
async function nextKickoff(cookie, week) {
  if (!week) return null;
  try {
    const matchups = await scheduleMatchups(cookie, week);
    const now = Math.floor(Date.now() / 1000);
    const times = matchups.map((m) => Number(m && m.kickoff)).filter((t) => t && t >= now);
    if (!times.length) return null;
    return new Date(Math.min(...times) * 1000).toISOString();
  } catch (e) {
    console.log(`[nextKickoff] week=${week} failed: ${e.message}`);
    return null;
  }
}

// A team's upcoming opponents over the next `count` weeks, from MFL's
// nflSchedule. Returns [{ week, opp, difficulty }]. `difficulty` is null: we
// don't wire a defense-strength source in live yet, so we surface the real
// schedule (opponent + home/away) without fabricating a strength-of-schedule
// rating. A bye week is simply absent from the list.
async function upcomingOpponents(cookie, team, fromWeek, count = 4) {
  if (!team || !fromWeek) return [];
  const code = String(team).toUpperCase();
  const out = [];
  for (let w = fromWeek; w < fromWeek + count && w <= 18; w += 1) {
    try {
      const matchups = await scheduleMatchups(cookie, w);
      for (const m of matchups) {
        const teams = mfl.toArray(m && m.team);
        const meIdx = teams.findIndex((t) => String(t && t.id).toUpperCase() === code);
        if (meIdx === -1) continue;
        const opp = teams[1 - meIdx];
        if (!opp || !opp.id) break;
        // MFL lists the away team first, home second (best-effort) — mark away games.
        const away = meIdx === 0;
        out.push({ week: w, opp: `${away ? '@' : ''}${String(opp.id).toUpperCase()}`, difficulty: null });
        break;
      }
    } catch (e) {
      /* skip a week we couldn't fetch */
    }
  }
  return out;
}

module.exports = { currentWeek, byeMap, injuryMap, nextKickoff, upcomingOpponents, _resetWeekCache };
