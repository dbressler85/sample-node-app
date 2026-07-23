'use strict';

// Prior-season box-score stats (passing / rushing / receiving) from Sleeper's public season-stats
// endpoint, keyed by Sleeper player id. We already join MFL ↔ Sleeper via the FantasyCalc crosswalk
// (enrichment.sleeperId), so the player card can attach real box-score numbers to the fantasy-point
// total it already gets from MFL. A completed season never changes, so we cache each year for a
// long TTL (and keep last-good on a fetch failure — the stat line is a nice-to-have, never blocking).

const config = require('../config');

const SLEEPER_SEASON_URL = (year) => `https://api.sleeper.app/v1/stats/nfl/regular/${year}`;
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — a finished season is static; this just bounds staleness
const cache = new Map(); // year -> { at, map: Map<sleeperId, box> }

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': config.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Math.round(Number(v) * 10) / 10);

// Reduce a Sleeper stat blob to the box score the card shows. Only include a category group when it
// has real activity, so a WR doesn't render an all-zero passing line.
function boxScore(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  const passing = { att: n(s.pass_att), cmp: n(s.pass_cmp), yds: n(s.pass_yd), td: n(s.pass_td), int: n(s.pass_int) };
  const rushing = { att: n(s.rush_att), yds: n(s.rush_yd), td: n(s.rush_td) };
  const receiving = { rec: n(s.rec), yds: n(s.rec_yd), td: n(s.rec_td), tgt: n(s.rec_tgt) };
  if (passing.att || passing.yds || passing.td) out.passing = passing;
  if (rushing.att || rushing.yds || rushing.td) out.rushing = rushing;
  if (receiving.rec || receiving.yds || receiving.td) out.receiving = receiving;
  const gp = n(s.gp) || null;
  if (!out.passing && !out.rushing && !out.receiving) return gp ? { gp } : null;
  return gp ? { ...out, gp } : out;
}

// Season stats as a Map<sleeperId, box>. Cached per year; fail-soft to an empty map (or last-good).
async function bySleeperId(year) {
  const key = String(year);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  try {
    const raw = await fetchJson(SLEEPER_SEASON_URL(year));
    const map = new Map();
    for (const [sid, s] of Object.entries(raw || {})) {
      const box = boxScore(s);
      if (box) map.set(String(sid), box);
    }
    cache.set(key, { at: Date.now(), map });
    return map;
  } catch (e) {
    if (hit) return hit.map; // keep last-good
    const empty = new Map();
    cache.set(key, { at: Date.now(), map: empty });
    return empty;
  }
}

// The box score for one player (by Sleeper id) in a given season, or null.
async function forPlayer(sleeperId, year) {
  if (!sleeperId) return null;
  const map = await bySleeperId(year);
  return map.get(String(sleeperId)) || null;
}

module.exports = { bySleeperId, forPlayer, boxScore };
