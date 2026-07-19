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

// Team bye weeks for a given week: MFL's nflSchedule lists that week's matchups;
// any NFL team not appearing is on bye. We compare against the full team set
// derived from the loaded player pool (same MFL team codes), so a bye sidelines
// skill players, kickers, and defenses alike. Returns { [TEAM]: week }.
async function byeMap(cookie, week) {
  if (!week) return {};
  try {
    const res = await mfl.exportRequest('nflSchedule', { cookie, W: week });
    const matchups = mfl.toArray(res && res.nflSchedule && res.nflSchedule.matchup);
    const playing = new Set();
    for (const m of matchups) {
      for (const t of mfl.toArray(m && m.team)) {
        if (t && t.id) playing.add(String(t.id).toUpperCase());
      }
    }
    if (!playing.size) return {};
    const byId = await playersLib.load(cookie);
    const byes = {};
    for (const p of byId.values()) {
      const team = String(p.team || '').toUpperCase();
      if (team && team !== 'FA' && !playing.has(team)) byes[team] = week;
    }
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

module.exports = { currentWeek, byeMap, injuryMap, _resetWeekCache };
