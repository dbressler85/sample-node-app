'use strict';

// Shared NFL-schedule helpers used by multiple services (lineups, roster, ...).
// Kept in one place so bye-week logic is consistent everywhere.

const mfl = require('./mfl');
const playersLib = require('./players');

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
    return {};
  }
}

module.exports = { byeMap, injuryMap };
