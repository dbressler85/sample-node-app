'use strict';

// Per-week raw stat lines from Sleeper's public endpoints, keyed by Sleeper player id:
//   * actual   -> https://api.sleeper.app/v1/stats/nfl/regular/{year}/{week}
//   * projected-> https://api.sleeper.app/v1/projections/nfl/regular/{year}/{week}
// Both return { sleeperId: { pass_yd, pass_td, rush_yd, rec, ... } }. We already join MFL ↔ Sleeper via
// the FantasyCalc crosswalk (enrichment.sleeperId), so a caller can pull one player's raw line for a
// given week and run it through the shared scoring engine (lib/scoring.js) at ANY format — this is what
// lets the player-schedule table score a fixed PPR / TE-premium basis instead of a league's own scoring
// (MFL only ever scores under a league's rules; it won't recompute an arbitrary basis for us).
//
// A week's file is small (one week, all players). We cache per (kind, year, week) and coalesce
// concurrent cold callers onto one fetch, so a schedule that needs ~18 weeks pays each week once and
// later opens (or other players' schedules) reuse the same maps. A completed past week is static; the
// current week's actuals and every projection still drift, so the TTL is a middle ground, not forever.

const config = require('../config');

const ACTUAL_URL = (year, week) => `https://api.sleeper.app/v1/stats/nfl/regular/${year}/${week}`;
const PROJECTED_URL = (year, week) => `https://api.sleeper.app/v1/projections/nfl/regular/${year}/${week}`;
const TTL_MS = 30 * 60 * 1000; // 30m — bounds staleness for the live week / projections; static weeks re-fetch harmlessly

const cache = new Map(); // `${kind}:${year}:${week}` -> { at, map: Map<sleeperId, stat> }
const inflight = new Map(); // same key -> Promise<Map>

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

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

// Map one Sleeper stat/projection blob to the stat keys lib/scoring.js reads. Returns null when the
// blob carries no scoring events at all, so a player who didn't play (or has no projection) reads as
// "no data" (null points) rather than a fabricated 0.
function toStatLine(s) {
  if (!s || typeof s !== 'object') return null;
  const line = {
    passYds: num(s.pass_yd),
    passTd: num(s.pass_td),
    passInt: num(s.pass_int),
    rushYds: num(s.rush_yd),
    rushTd: num(s.rush_td),
    recYds: num(s.rec_yd),
    recTd: num(s.rec_td),
    rec: num(s.rec),
    fumblesLost: num(s.fum_lost),
  };
  const any = line.passYds || line.passTd || line.passInt || line.rushYds || line.rushTd
    || line.recYds || line.recTd || line.rec || line.fumblesLost;
  return any ? line : null;
}

async function load(kind, year, week) {
  const urlFor = kind === 'projected' ? PROJECTED_URL : ACTUAL_URL;
  const key = `${kind}:${year}:${week}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const raw = await fetchJson(urlFor(year, week));
      const map = new Map();
      for (const [sid, s] of Object.entries(raw || {})) {
        const line = toStatLine(s);
        if (line) map.set(String(sid), line);
      }
      cache.set(key, { at: Date.now(), map });
      return map;
    } catch (e) {
      if (hit) return hit.map; // keep last-good
      const empty = new Map();
      cache.set(key, { at: Date.now(), map: empty });
      return empty;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// Raw actual stat line for one player (by Sleeper id) in a given week, or null.
async function actual(year, week, sleeperId) {
  if (!sleeperId) return null;
  return (await load('actual', year, week)).get(String(sleeperId)) || null;
}

// Raw projected stat line for one player (by Sleeper id) in a given week, or null.
async function projected(year, week, sleeperId) {
  if (!sleeperId) return null;
  return (await load('projected', year, week)).get(String(sleeperId)) || null;
}

function _reset() {
  cache.clear();
  inflight.clear();
}

module.exports = { actual, projected, toStatLine, _reset };
