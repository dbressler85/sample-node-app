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
// FantasyCalc's Terms of Use ask that cached results ideally be retrieved once per day, so its
// values get a longer, dedicated TTL than the other (Sleeper/ownership/adds) providers above.
const FC_TTL_MS = 24 * 60 * 60 * 1000; // 24h — align FantasyCalc refresh with their ToU (§3e)
const SLEEPER_TREND_URL = 'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=300';

const DEFAULT_FORMAT = { numQbs: 1, ppr: 1, tePpr: 1 };

// Position value adjustments for the dimensions the base value source doesn't already
// encode. A QB is worth far more in superflex/2QB; a TE is worth more when it scores
// extra per reception (TE premium). Live FantasyCalc already bakes in the superflex QB
// premium (fetched per numQbs), so we only add TE premium there; demo values are flat,
// so we apply both.
const SUPERFLEX_QB_MULT = 1.7;
// Team defense and kicker aren't in the dynasty-value source (FantasyCalc covers skill positions
// only), so they'd be value-null and effectively INVISIBLE across the app — sinking below every
// valued player, never surfacing in "best available"/rankings/suggestions, and reading blank on
// rosters. Give them a small positional baseline so they're present and ranked low (as befits
// streamed positions) in leagues that use them, without meaningfully distorting skill-position
// trade math. Other value-less ids (deep IDP, unknowns) stay null.
const STREAMER_BASELINE = { DEF: 2, PK: 0 };
function teMult(fmt) {
  const premium = Math.max(0, (fmt.tePpr != null ? fmt.tePpr : fmt.ppr) - fmt.ppr);
  return 1 + Math.min(premium, 1) * 0.5; // up to +50% at a full +1.0 per-reception TE premium
}
// applyQb: apply the superflex QB premium here (true for demo; false for live FantasyCalc).
function adjustValue(base, position, fmt, applyQb) {
  if (base == null) return STREAMER_BASELINE[position] != null ? STREAMER_BASELINE[position] : null;
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

// In-flight promise coalescing: on a cold cache, a burst of concurrent snapshot() calls (one per
// league, across ~6 formats) would each fire the SAME external fetch. The resolved-value caches above
// only help AFTER the first fetch returns. These hold the pending promise so simultaneous callers
// share one request per provider (per format for FantasyCalc) instead of stampeding the API.
const fcInflight = new Map(); // format key -> pending getFantasyCalc promise
let sleeperInflight = null;
let ownershipInflight = null;
let addsInflight = null;

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
// FantasyCalc prices by league size too; bucket to the common team counts it serves so we don't
// fragment the cache on odd sizes. Default 12 (the modal league, and FantasyCalc's own default).
function bucketTeams(v) {
  if (!Number.isFinite(v) || v <= 0) return 12;
  return [8, 10, 12, 14, 16].reduce((best, n) => (Math.abs(n - v) < Math.abs(best - v) ? n : best), 12);
}
function normalizeFormat(f) {
  const numQbs = Number(f && f.numQbs) === 2 ? 2 : 1;
  const ppr = bucketPpr(Number(f && f.ppr), 1); // FantasyCalc accepts 0 / 0.5 / 1; default full PPR
  const fcPpr = ppr > 1 ? 1 : ppr; // FantasyCalc caps at 1
  const tePpr = bucketPpr(Number(f && f.tePpr), ppr); // TE per-reception points (>= ppr means premium)
  const numTeams = bucketTeams(Number(f && f.numTeams));
  return { numQbs, ppr: fcPpr, tePpr, numTeams };
}
function formatKey(f) {
  return `${f.numQbs}|${f.ppr}|${f.tePpr}|${f.numTeams}`;
}

// FantasyCalc values for one format (values normalized to 0-100), plus age, rank,
// and the Sleeper->MFL crosswalk (crosswalk is identical across formats).
async function getFantasyCalc(format) {
  // FantasyCalc varies by numQbs + ppr + numTeams (no TE-premium param), so key on those —
  // TE premium is applied afterward as a value multiplier.
  const key = `${format.numQbs}|${format.ppr}|${format.numTeams}`;
  const hit = fcCache.get(key);
  if (hit && Date.now() - hit.at < FC_TTL_MS) return hit;
  if (fcInflight.has(key)) return fcInflight.get(key); // a fetch for this format is already running — share it
  const p = buildFantasyCalc(format, key, hit);
  fcInflight.set(key, p);
  try { return await p; } finally { fcInflight.delete(key); }
}

// FantasyCalc lists draft PICKS alongside players (position "PICK"), FORMAT-AWARE and per-slot, e.g.
// { name: "2026 Pick 1.01", mflId: "DP_0_0", position: "PICK" }. The mflId is already our own token
// scheme, so current-draft picks join by token via the `value` map above. For future-year picks we
// also index by parsed label (exact slot + a round-level average) so a token that doesn't match FC
// can still resolve. Returns { year, round, pick|null } or null.
function parsePickName(name) {
  const s = String(name || '');
  const ym = /\b(20\d{2})\b/.exec(s);
  if (!ym) return null;
  const slot = /\b(\d+)\.(\d{1,2})\b/.exec(s); // "1.01"
  if (slot) return { year: ym[1], round: Number(slot[1]), pick: Number(slot[2]) };
  const ord = /\b(\d+)\s*(?:st|nd|rd|th)\b/i.exec(s); // "1st"
  if (ord) return { year: ym[1], round: Number(ord[1]), pick: null };
  return null;
}

// FantasyCalc pick value for one of OUR pick tokens/labels (already normalized to 0-100), or null when
// FC doesn't cover it (→ caller falls back to the local curve). Token first (exact join for current
// picks), then exact-slot label, then the round-level average (covers future picks named by round).
function pickValueFromFc(fc, label, token) {
  if (token != null && fc.value.has(String(token))) return fc.value.get(String(token));
  const pk = parsePickName(label);
  if (!pk) return null;
  if (pk.pick != null) {
    const exact = `${pk.year} ${pk.round}.${String(pk.pick).padStart(2, '0')}`;
    if (fc.pickByLabel.has(exact)) return fc.pickByLabel.get(exact);
  }
  const rk = `${pk.year}|${pk.round}`;
  return fc.pickRound.has(rk) ? fc.pickRound.get(rk) : null;
}

async function buildFantasyCalc(format, key, hit) {
  const value = new Map();
  const age = new Map();
  const rank = new Map();
  const pos = new Map();
  const sleeperToMfl = new Map();
  const mflToSleeper = new Map(); // reverse crosswalk — drives the profile headshot (Sleeper CDN)
  const pickByLabel = new Map(); // "2026 1.01" -> normalized value (for label joins)
  const pickRoundAcc = new Map(); // "2027|1" -> { sum, n } → round-level average (future picks)
  const winNow = new Map(); // mflId -> redraftValue normalized 0-100 (the win-now / this-season lens)
  const trend30 = new Map(); // mflId -> 30-day value momentum, signed, on the dynasty 0-100 scale
  try {
    const url = `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${format.numQbs}&ppr=${format.ppr}&numTeams=${format.numTeams}`;
    const rows = await fetchJson(url);
    const list = Array.isArray(rows) ? rows : [];
    // Dynasty value and redraft (win-now) value are on different scales, so each is normalized to
    // 0-100 by its OWN max — a win-now lens then reads "100 = the most valuable player to win THIS
    // season," independent of the dynasty ranking. trend30Day is a delta, normalized on the dynasty scale.
    let maxVal = 0;
    let maxRedraft = 0;
    for (const r of list) { maxVal = Math.max(maxVal, Number(r.value) || 0); maxRedraft = Math.max(maxRedraft, Number(r.redraftValue) || 0); }
    for (const r of list) {
      const p = r.player || {};
      const mflId = p.mflId != null && p.mflId !== '' ? String(p.mflId) : null;
      const sleeperId = p.sleeperId != null && p.sleeperId !== '' ? String(p.sleeperId) : null;
      if (sleeperId && mflId) { sleeperToMfl.set(sleeperId, mflId); mflToSleeper.set(mflId, sleeperId); }
      const norm = maxVal > 0 && r.value != null ? Math.max(1, Math.round((Number(r.value) / maxVal) * 100)) : null;
      // Draft picks: index by parsed label too, so future-year picks (whose token won't match FC's)
      // still resolve. Current picks also keep the token join via the `value` map below (mflId="DP_…").
      if (String(p.position).toUpperCase() === 'PICK' && norm != null) {
        const pk = parsePickName(p.name);
        if (pk) {
          if (pk.pick != null) pickByLabel.set(`${pk.year} ${pk.round}.${String(pk.pick).padStart(2, '0')}`, norm);
          const rk = `${pk.year}|${pk.round}`;
          const acc = pickRoundAcc.get(rk) || { sum: 0, n: 0 };
          acc.sum += norm; acc.n += 1; pickRoundAcc.set(rk, acc);
        }
      }
      if (!mflId) continue;
      if (norm != null) value.set(mflId, norm);
      if (r.overallRank != null) rank.set(mflId, Number(r.overallRank));
      if (p.position) pos.set(mflId, String(p.position).toUpperCase());
      const a = p.maybeAge != null ? Number(p.maybeAge) : NaN;
      if (Number.isFinite(a) && a > 0) age.set(mflId, Math.round(a * 10) / 10);
      // Win-now (redraft) value, normalized by its own max so it's a self-contained 0-100 lens.
      if (maxRedraft > 0 && r.redraftValue != null) winNow.set(mflId, Math.max(1, Math.round((Number(r.redraftValue) / maxRedraft) * 100)));
      // 30-day value momentum: FantasyCalc's raw delta scaled onto the dynasty 0-100 scale, sign kept.
      if (maxVal > 0 && r.trend30Day != null && Number(r.trend30Day) !== 0) {
        trend30.set(mflId, Math.round((Number(r.trend30Day) / maxVal) * 100 * 10) / 10);
      }
    }
    console.log(`[enrichment] fantasycalc format=${key} rows=${list.length} values=${value.size} picks=${pickByLabel.size} winNow=${winNow.size}`);
  } catch (e) {
    console.log(`[enrichment] fantasycalc format=${key} error=${e.message}`);
    // Don't overwrite good data with an empty result on a transient failure —
    // keep serving the last-good snapshot (even if a bit stale) and retry later.
    if (hit) return hit;
  }
  const pickRound = new Map();
  for (const [rk, acc] of pickRoundAcc) pickRound.set(rk, Math.max(1, Math.round(acc.sum / acc.n)));
  const entry = { at: Date.now(), value, age, rank, pos, sleeperToMfl, mflToSleeper, pickByLabel, pickRound, winNow, trend30 };
  fcCache.set(key, entry);
  return entry;
}

// Sleeper trending adds (sleeperId -> count), fetched once and cached (in-flight coalesced).
async function getSleeperTrending() {
  if (sleeperCache.raw.size && Date.now() - sleeperCache.at < TTL_MS) return sleeperCache.raw;
  if (sleeperInflight) return sleeperInflight;
  const p = buildSleeperTrending();
  sleeperInflight = p;
  try { return await p; } finally { sleeperInflight = null; }
}
async function buildSleeperTrending() {
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
  if (ownershipInflight) return ownershipInflight;
  const p = buildMflOwnership(cookie);
  ownershipInflight = p;
  try { return await p; } finally { ownershipInflight = null; }
}
async function buildMflOwnership(cookie) {
  const map = new Map();
  try {
    // topOwns returns players by site-wide ownership %, DESCENDING (fields: id + percent). Without a
    // high COUNT it returns only the most-owned studs (~97-100%), so the mid-owned free agents on the
    // waiver wire (~30-60% — real values, confirmed against MFL's own FA listing) fall off the end
    // and show no %. Request a large COUNT to reach down to them; MFL only returns players owned in
    // >2% of leagues, so this is naturally bounded (~hundreds of rows, a few KB).
    const res = await mfl.exportRequest('topOwns', { cookie, COUNT: 2000 });
    const rows = mfl.toArray(res && res.topOwns && res.topOwns.player);
    for (const r of rows) {
      const id = r.id != null ? String(r.id) : null;
      const pct = fieldNum(r, OWN_FIELDS);
      if (id && pct != null) map.set(id, Math.round(pct * 10) / 10);
    }
    warnIfUnparsed('topOwns', rows, map.size);
    console.log(`[enrichment] mfl topOwns owned=${map.size} (of ${rows.length} rows)`);
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
  if (addsInflight) return addsInflight;
  const p = buildMflAdds(cookie);
  addsInflight = p;
  try { return await p; } finally { addsInflight = null; }
}
async function buildMflAdds(cookie) {
  const map = new Map();
  try {
    // Same as topOwns: request a large COUNT so mid-list free agents get their add count, not just
    // the few hottest adds at the top (bounded — MFL only returns players added in >1% of leagues).
    const res = await mfl.exportRequest('topAdds', { cookie, COUNT: 2000 });
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
  const [fc, sleeperRaw, owned, mflAdds, byId] = await Promise.all([
    getFantasyCalc(format),
    getSleeperTrending(),
    getMflOwnership(cookie),
    getMflAdds(cookie),
    players.load(cookie).catch(() => new Map()),
  ]);
  // Position for the value multiplier + streamer baseline: FantasyCalc's rows first, then the player
  // DB — which carries DEF/PK, the positions FantasyCalc omits (so their baseline value resolves).
  const posOf = (id) => fc.pos.get(String(id)) || (byId.get(String(id)) ? byId.get(String(id)).position : '') || '';
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
    // Win-now (redraft) value on the same treatment — the "help me THIS season" lens.
    winNow: (id) => adjustValue(fc.winNow.has(String(id)) ? fc.winNow.get(String(id)) : null, posOf(id), format, false),
    // Real 30-day value momentum (signed, on the 0-100 scale), distinct from add-heat `trend`.
    valueTrend: (id) => (fc.trend30.has(String(id)) ? fc.trend30.get(String(id)) : null),
    age: (id) => (fc.age.has(String(id)) ? fc.age.get(String(id)) : null),
    trend: (id) => trend.get(String(id)) || 0,
    ownership: (id) => (owned.has(String(id)) ? owned.get(String(id)) : null), // MFL topOwns site-wide %
    sleeperId: (id) => fc.mflToSleeper.get(String(id)) || null, // Sleeper player id, for the headshot
    rank: (id) => fc.rank.get(String(id)) || null,
    // FantasyCalc's format-aware pick value for one of our pick tokens/labels (0-100), or null when FC
    // doesn't cover it → picksLib.value falls back to the local curve.
    pickValue: (label, token) => pickValueFromFc(fc, label, token),
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
    // Demo has no separate redraft feed; mirror dynasty so the win-now lens is populated (flat).
    winNow: (id) => {
      const d = demo.dynasty(id);
      return adjustValue(d && d.value != null ? d.value : null, posOf(id), format, true);
    },
    valueTrend: () => null, // demo has no 30-day value momentum
    age: (id) => {
      const d = demo.dynasty(id);
      return d && d.age != null ? d.age : null;
    },
    trend: (id) => demo.trend(id),
    ownership: (id) => demo.ownership(id),
    sleeperId: (id) => demo.sleeperId(id),
    rank: () => null,
    pickValue: () => null, // demo has no FantasyCalc pick data → picks use the local curve
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
