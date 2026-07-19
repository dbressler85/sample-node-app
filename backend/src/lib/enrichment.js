'use strict';

// External enrichment layer — the data MyFantasyLeague doesn't publish well:
// dynasty trade values, player age, and waiver-wire heat (trends).
//
// Providers (both free, no key/login):
//   * FantasyCalc  -> community dynasty values + age. Its player objects carry
//                     BOTH mflId and sleeperId, so it joins directly to our MFL
//                     ids AND gives us a Sleeper->MFL crosswalk for free.
//                     Values are FORMAT-AWARE: fetched per {numQbs, ppr}, since a
//                     QB is worth far more in superflex than 1QB.
//   * Sleeper      -> trending adds (waiver heat), keyed by sleeperId, mapped to
//                     MFL via that crosswalk (format-independent).
//
// Everything is fetched on a long in-memory TTL (these move slowly) and never
// blocks an MFL call. On any provider failure we degrade to nulls, so the app
// behaves exactly as it did before enrichment rather than erroring.

const config = require('../config');
const demo = require('../demo/fixtures');

const TTL_MS = 6 * 60 * 60 * 1000; // 6h — dynasty values/trends change slowly
const SLEEPER_TREND_URL = 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=300';

const DEFAULT_FORMAT = { numQbs: 1, ppr: 1 };

// FantasyCalc value map cache, keyed by format; Sleeper trending cached once.
const fcCache = new Map(); // "numQbs|ppr" -> { at, value, age, rank, sleeperToMfl }
let sleeperCache = { at: 0, raw: new Map() }; // sleeperId -> count

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

function normalizeFormat(f) {
  const numQbs = Number(f && f.numQbs) === 2 ? 2 : 1;
  const raw = Number(f && f.ppr);
  const ppr = raw >= 1 ? 1 : raw >= 0.5 ? 0.5 : 0; // FantasyCalc accepts 0 / 0.5 / 1
  return { numQbs, ppr };
}
function formatKey(f) {
  return `${f.numQbs}|${f.ppr}`;
}

// FantasyCalc values for one format (values normalized to 0-100), plus age, rank,
// and the Sleeper->MFL crosswalk (crosswalk is identical across formats).
async function getFantasyCalc(format) {
  const key = formatKey(format);
  const hit = fcCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const value = new Map();
  const age = new Map();
  const rank = new Map();
  const sleeperToMfl = new Map();
  try {
    const url = `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${format.numQbs}&ppr=${format.ppr}`;
    const rows = await fetchJson(url);
    const list = Array.isArray(rows) ? rows : [];
    let maxVal = 0;
    for (const r of list) maxVal = Math.max(maxVal, Number(r.value) || 0);
    for (const r of list) {
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
    console.log(`[enrichment] fantasycalc format=${key} rows=${list.length} values=${value.size}`);
  } catch (e) {
    console.log(`[enrichment] fantasycalc format=${key} error=${e.message}`);
  }
  const entry = { at: Date.now(), value, age, rank, sleeperToMfl };
  fcCache.set(key, entry);
  return entry;
}

// Sleeper trending adds (sleeperId -> count), fetched once and cached.
async function getSleeperTrending() {
  if (sleeperCache.raw.size && Date.now() - sleeperCache.at < TTL_MS) return sleeperCache.raw;
  const raw = new Map();
  try {
    const rows = await fetchJson(SLEEPER_TREND_URL);
    for (const r of Array.isArray(rows) ? rows : []) raw.set(String(r.player_id), Number(r.count) || 0);
    console.log(`[enrichment] sleeper trending=${raw.size}`);
  } catch (e) {
    console.log(`[enrichment] sleeper error=${e.message}`);
  }
  sleeperCache = { at: Date.now(), raw };
  return raw;
}

async function buildLive(format) {
  const fc = await getFantasyCalc(format);
  const sleeperRaw = await getSleeperTrending();
  // Map trending counts onto MFL ids via the crosswalk.
  const trend = new Map();
  for (const [sleeperId, count] of sleeperRaw) {
    const mflId = fc.sleeperToMfl.get(sleeperId);
    if (mflId) trend.set(mflId, count);
  }
  return {
    value: (id) => (fc.value.has(String(id)) ? fc.value.get(String(id)) : null),
    age: (id) => (fc.age.has(String(id)) ? fc.age.get(String(id)) : null),
    trend: (id) => trend.get(String(id)) || 0,
    ownership: () => null, // no free site-wide ownership source; trend is the heat signal
    rank: (id) => fc.rank.get(String(id)) || null,
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

// A snapshot with synchronous accessors, for a given league format. Callers
// `await snapshot(format)` once per request, then look players up synchronously.
// Omit `format` for the neutral default (1QB, full PPR) used by global views.
async function snapshot(format) {
  if (config.demoMode) return demoSnapshot();
  return buildLive(normalizeFormat(format || DEFAULT_FORMAT));
}

module.exports = { snapshot, DEFAULT_FORMAT };
