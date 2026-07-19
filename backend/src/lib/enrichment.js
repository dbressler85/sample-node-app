'use strict';

// External enrichment layer — the data MyFantasyLeague doesn't publish well:
// dynasty trade values, player age, and waiver-wire heat (trends).
//
// Providers (both free, no key/login):
//   * FantasyCalc  -> community dynasty values + age. Its player objects carry
//                     BOTH mflId and sleeperId, so it joins directly to our MFL
//                     ids AND gives us a Sleeper->MFL crosswalk for free.
//   * Sleeper      -> trending adds (waiver heat), keyed by sleeperId, mapped to
//                     MFL via that crosswalk.
//
// Everything is fetched on a long in-memory TTL (these move slowly) and never
// blocks an MFL call. On any provider failure we degrade to nulls, so the app
// behaves exactly as it did before enrichment rather than erroring.

const config = require('../config');
const demo = require('../demo/fixtures');

const TTL_MS = 6 * 60 * 60 * 1000; // 6h — dynasty values/trends change slowly
const FANTASYCALC_URL = 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&ppr=1';
const SLEEPER_TREND_URL = 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=300';

let cache = { at: 0, snap: null };

async function fetchJson(url, ms = 10000) {
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

// Build the live snapshot from the external providers. Pure of our own I/O.
async function buildLive() {
  const value = new Map(); // mflId -> 0..100 dynasty value
  const age = new Map(); // mflId -> years
  const rank = new Map(); // mflId -> overall dynasty rank
  const trend = new Map(); // mflId -> waiver-add heat
  const sleeperToMfl = new Map();

  // FantasyCalc: dynasty values (normalized to 0-100), age, and the crosswalk.
  try {
    const list = await fetchJson(FANTASYCALC_URL);
    const rows = Array.isArray(list) ? list : [];
    let maxVal = 0;
    for (const r of rows) maxVal = Math.max(maxVal, Number(r.value) || 0);
    for (const r of rows) {
      const p = r.player || {};
      const mflId = p.mflId != null && p.mflId !== '' ? String(p.mflId) : null;
      const sleeperId = p.sleeperId != null && p.sleeperId !== '' ? String(p.sleeperId) : null;
      if (sleeperId && mflId) sleeperToMfl.set(sleeperId, mflId);
      if (!mflId) continue;
      if (maxVal > 0 && r.value != null) value.set(mflId, Math.max(1, Math.round((Number(r.value) / maxVal) * 100)));
      if (r.overallRank != null) rank.set(mflId, Number(r.overallRank));
      const a = p.maybeAge != null ? Number(p.maybeAge) : NaN;
      if (Number.isFinite(a) && a > 0) age.set(mflId, Math.round(a * 10) / 10);
    }
    console.log(`[enrichment] fantasycalc rows=${rows.length} values=${value.size} crosswalk=${sleeperToMfl.size}`);
  } catch (e) {
    console.log(`[enrichment] fantasycalc error=${e.message}`);
  }

  // Sleeper trending adds -> waiver heat, mapped to MFL via the crosswalk.
  try {
    const rows = await fetchJson(SLEEPER_TREND_URL);
    let mapped = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
      const mflId = sleeperToMfl.get(String(r.player_id));
      if (mflId) {
        trend.set(mflId, Number(r.count) || 0);
        mapped += 1;
      }
    }
    console.log(`[enrichment] sleeper trending mapped=${mapped}`);
  } catch (e) {
    console.log(`[enrichment] sleeper error=${e.message}`);
  }

  return {
    value: (id) => (value.has(String(id)) ? value.get(String(id)) : null),
    age: (id) => (age.has(String(id)) ? age.get(String(id)) : null),
    trend: (id) => trend.get(String(id)) || 0,
    ownership: () => null, // no free site-wide ownership source; trend is the heat signal
    rank: (id) => rank.get(String(id)) || null,
  };
}

// Demo snapshot delegates to the fixtures, so demo behavior is unchanged.
function demoSnapshot() {
  return {
    value: (id) => {
      const d = demo.dynasty(id);
      return d && d.value != null ? d.value : null;
    },
    age: (id) => {
      const d = demo.dynasty(id);
      return d && d.age != null ? d.age : null;
    },
    trend: (id) => demo.trend(id),
    ownership: (id) => demo.ownership(id),
    rank: () => null,
  };
}

// A cached snapshot with synchronous accessors. Callers `await snapshot()` once
// per request, then look players up synchronously.
async function snapshot() {
  if (config.demoMode) return demoSnapshot();
  if (cache.snap && Date.now() - cache.at < TTL_MS) return cache.snap;
  const snap = await buildLive();
  cache = { at: Date.now(), snap };
  return snap;
}

module.exports = { snapshot, _buildLive: buildLive };
