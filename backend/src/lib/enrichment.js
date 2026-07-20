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
const mfl = require('./mfl');
const players = require('./players');
const { createMemo } = require('./memo');

const TTL_MS = 6 * 60 * 60 * 1000; // 6h — dynasty values/trends change slowly
const SLEEPER_TREND_URL = 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=300';

const DEFAULT_FORMAT = { numQbs: 1, ppr: 1, tePpr: 1 };

// Position value adjustments for the dimensions the base value source doesn't already
// encode. A QB is worth far more in superflex/2QB; a TE is worth more when it scores
// extra per reception (TE premium). Live FantasyCalc already bakes in the superflex QB
// premium (fetched per numQbs), so we only add TE premium there; demo values are flat,
// so we apply both.
const SUPERFLEX_QB_MULT = 1.7;
function teMult(fmt) {
  const premium = Math.max(0, (fmt.tePpr != null ? fmt.tePpr : fmt.ppr) - fmt.ppr);
  return 1 + Math.min(premium, 1) * 0.5; // up to +50% at a full +1.0 per-reception TE premium
}
// applyQb: apply the superflex QB premium here (true for demo; false for live FantasyCalc).
function adjustValue(base, position, fmt, applyQb) {
  if (base == null) return null;
  let m = 1;
  if (position === 'QB' && applyQb && fmt.numQbs === 2) m *= SUPERFLEX_QB_MULT;
  if (position === 'TE') m *= teMult(fmt);
  return m === 1 ? base : Math.max(1, Math.round(base * m));
}

// FantasyCalc value map cache, keyed by format; Sleeper trending cached once.
const fcCache = new Map(); // "numQbs|ppr" -> { at, value, age, rank, sleeperToMfl }
let sleeperCache = { at: 0, raw: new Map() }; // sleeperId -> count
let ownershipCache = { at: 0, map: new Map() }; // mflId -> owned % (site-wide, from MFL topOwns)
let addsCache = { at: 0, map: new Map() }; // mflId -> add count (site-wide, from MFL topAdds)

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

function bucketPpr(v, fallback) {
  if (!Number.isFinite(v)) return fallback;
  if (v >= 2) return 2;
  if (v >= 1.5) return 1.5;
  if (v >= 1) return 1;
  if (v >= 0.5) return 0.5;
  return 0;
}
function normalizeFormat(f) {
  const numQbs = Number(f && f.numQbs) === 2 ? 2 : 1;
  const ppr = bucketPpr(Number(f && f.ppr), 1); // FantasyCalc accepts 0 / 0.5 / 1; default full PPR
  const fcPpr = ppr > 1 ? 1 : ppr; // FantasyCalc caps at 1
  const tePpr = bucketPpr(Number(f && f.tePpr), ppr); // TE per-reception points (>= ppr means premium)
  return { numQbs, ppr: fcPpr, tePpr };
}
function formatKey(f) {
  return `${f.numQbs}|${f.ppr}|${f.tePpr}`;
}

// FantasyCalc values for one format (values normalized to 0-100), plus age, rank,
// and the Sleeper->MFL crosswalk (crosswalk is identical across formats).
async function getFantasyCalc(format) {
  // FantasyCalc only varies by numQbs + ppr (no TE-premium param), so key on those —
  // TE premium is applied afterward as a value multiplier.
  const key = `${format.numQbs}|${format.ppr}`;
  const hit = fcCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;

  const value = new Map();
  const age = new Map();
  const rank = new Map();
  const pos = new Map();
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
      if (p.position) pos.set(mflId, String(p.position).toUpperCase());
      const a = p.maybeAge != null ? Number(p.maybeAge) : NaN;
      if (Number.isFinite(a) && a > 0) age.set(mflId, Math.round(a * 10) / 10);
    }
    console.log(`[enrichment] fantasycalc format=${key} rows=${list.length} values=${value.size}`);
  } catch (e) {
    console.log(`[enrichment] fantasycalc format=${key} error=${e.message}`);
    // Don't overwrite good data with an empty result on a transient failure —
    // keep serving the last-good snapshot (even if a bit stale) and retry later.
    if (hit) return hit;
  }
  const entry = { at: Date.now(), value, age, rank, pos, sleeperToMfl };
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
    if (sleeperCache.raw.size) return sleeperCache.raw; // keep last-good on failure
  }
  sleeperCache = { at: Date.now(), raw };
  return raw;
}

// First finite numeric among candidate field names on an MFL row.
function fieldNum(row, fields) {
  for (const f of fields) {
    if (row[f] != null && row[f] !== '') {
      const n = Number(row[f]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// A field-name mismatch used to look identical to "no data". If MFL returned
// rows but none parsed, log the actual keys so it's diagnosable, not silent.
function warnIfUnparsed(tag, rows, matched) {
  if (rows.length && !matched) {
    console.log(`[enrichment] ${tag} matched 0 of ${rows.length} rows — sample keys: ${Object.keys(rows[0] || {}).join(',')}`);
  }
}

const OWN_FIELDS = ['percent', 'owned', 'pct', 'ownership'];
const ADD_FIELDS = ['adds', 'count', 'percent', 'pct'];

// Site-wide ownership % from MFL's own topOwns export (keyed by MFL id — no
// crosswalk needed). Cached once; last-good on a transient failure.
async function getMflOwnership(cookie) {
  if (!cookie) return ownershipCache.map;
  if (ownershipCache.map.size && Date.now() - ownershipCache.at < TTL_MS) return ownershipCache.map;
  const map = new Map();
  try {
    const res = await mfl.exportRequest('topOwns', { cookie });
    const rows = mfl.toArray(res && res.topOwns && res.topOwns.player);
    for (const r of rows) {
      const id = r.id != null ? String(r.id) : null;
      const pct = fieldNum(r, OWN_FIELDS);
      if (id && pct != null) map.set(id, Math.round(pct * 10) / 10);
    }
    warnIfUnparsed('topOwns', rows, map.size);
    console.log(`[enrichment] mfl topOwns owned=${map.size}`);
  } catch (e) {
    console.log(`[enrichment] topOwns error=${e.message}`);
    if (ownershipCache.map.size) return ownershipCache.map; // keep last-good
  }
  ownershipCache = { at: Date.now(), map };
  return map;
}

// Site-wide add counts from MFL's own topAdds export (keyed by MFL id). Combined
// with Sleeper's trending adds so the "heat" signal reflects both platforms, and
// covers players the Sleeper crosswalk misses. Cached with last-good fallback.
async function getMflAdds(cookie) {
  if (!cookie) return addsCache.map;
  if (addsCache.map.size && Date.now() - addsCache.at < TTL_MS) return addsCache.map;
  const map = new Map();
  try {
    const res = await mfl.exportRequest('topAdds', { cookie });
    const rows = mfl.toArray(res && res.topAdds && res.topAdds.player);
    for (const r of rows) {
      const id = r.id != null ? String(r.id) : null;
      const n = fieldNum(r, ADD_FIELDS);
      if (id && n != null) map.set(id, n);
    }
    warnIfUnparsed('topAdds', rows, map.size);
    console.log(`[enrichment] mfl topAdds adds=${map.size}`);
  } catch (e) {
    console.log(`[enrichment] topAdds error=${e.message}`);
    if (addsCache.map.size) return addsCache.map;
  }
  addsCache = { at: Date.now(), map };
  return map;
}

async function buildLive(format, cookie) {
  // Fetch all providers in parallel to halve cold-start latency.
  const [fc, sleeperRaw, owned, mflAdds] = await Promise.all([
    getFantasyCalc(format),
    getSleeperTrending(),
    getMflOwnership(cookie),
    getMflAdds(cookie),
  ]);
  // Position for the value multiplier comes from FantasyCalc's own rows — no extra fetch.
  const posOf = (id) => fc.pos.get(String(id)) || '';
  // Combined add "heat": Sleeper trending adds (via crosswalk) + MFL topAdds.
  const trend = new Map();
  for (const [sleeperId, count] of sleeperRaw) {
    const mflId = fc.sleeperToMfl.get(sleeperId);
    if (mflId) trend.set(mflId, (trend.get(mflId) || 0) + count);
  }
  for (const [mflId, adds] of mflAdds) {
    trend.set(mflId, (trend.get(mflId) || 0) + adds);
  }
  return {
    // FantasyCalc already returns superflex-specific QB values; we only add TE premium.
    value: (id) => adjustValue(fc.value.has(String(id)) ? fc.value.get(String(id)) : null, posOf(id), format, false),
    age: (id) => (fc.age.has(String(id)) ? fc.age.get(String(id)) : null),
    trend: (id) => trend.get(String(id)) || 0,
    ownership: (id) => (owned.has(String(id)) ? owned.get(String(id)) : null), // MFL topOwns site-wide %
    rank: (id) => fc.rank.get(String(id)) || null,
  };
}

// Demo values are format-flat, so we apply both the superflex QB premium and TE premium
// here — making the demo showcase league-specific values the way live does.
async function buildDemo(format, cookie) {
  const byId = await players.load(cookie);
  const posOf = (id) => { const p = byId.get(String(id)); return p ? p.position : ''; };
  return {
    value: (id) => {
      const d = demo.dynasty(id);
      return adjustValue(d && d.value != null ? d.value : null, posOf(id), format, true);
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

// The snapshot's data sources are each 6h-cached, but the assembled snapshot —
// notably the trend-map rebuild in buildLive — was recomputed on every call, and
// snapshot() is called once per league inside Promise.all loops over all leagues.
// Memoize the assembled snapshot per (cookie, format). normalizeFormat collapses
// every league to one of six format keys, so N per-request rebuilds become at most
// six, shared across services; the short TTL keeps ownership/adds reasonably fresh.
const snapshotMemo = createMemo({ ttlMs: config.mflCacheTtlMs });

// A snapshot with synchronous accessors, for a given league format. Callers
// `await snapshot(format)` once per request, then look players up synchronously.
// Omit `format` for the neutral default (1QB, full PPR) used by global views.
async function snapshot(format, cookie) {
  const fmt = normalizeFormat(format || DEFAULT_FORMAT);
  if (config.demoMode) return snapshotMemo.get(`demo|${formatKey(fmt)}`, () => buildDemo(fmt, cookie));
  return snapshotMemo.get(`${cookie || ''}|${formatKey(fmt)}`, () => buildLive(fmt, cookie));
}

module.exports = { snapshot, DEFAULT_FORMAT };
