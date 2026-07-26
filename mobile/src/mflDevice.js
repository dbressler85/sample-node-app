// Device-origin MFL reads (docs/DEVICE_ORIGIN_MFL.md). The transport half: build + fetch + parse a
// read straight from MFL using the SHARED read core (mflRead — identical to the backend's), with the
// user's cookie from SecureStore. mflRead.readWith enforces MFL's rules for us (429 = throw, no retry;
// registered User-Agent; credential in a header, never the URL). Everything here is gated behind the
// DEVICE_READS flag AND the presence of cached creds, and every consumer wraps it in a backend
// fallback, so a device-read hiccup is never user-visible.
import mflRead from './mflRead';
import { DEVICE_READS } from './config';
import { loadMflCreds, refreshMflCreds } from './auth';
import { api } from './api';
import deviceReadCache from './deviceReadCache';
import { onCacheInvalidate } from './cache';
import poolMap from './poolMap';
import deviceHealth from './deviceHealth';

// Bound every on-device MFL fetch so a dead network (subway, U-3) fails FAST instead of hanging — the
// screen keeps its last cached data (C4) promptly rather than spinning. A timeout aborts to a plain error
// that classifies as `network`, which then opens the offline cooldown (deviceHealth) so the NEXT reads skip
// the device entirely and go straight to the backend.
const DEVICE_FETCH_TIMEOUT_MS = 8000;
function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEVICE_FETCH_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .catch((e) => { throw e && e.name === 'AbortError' ? new Error('device read timeout') : e; })
    .finally(() => clearTimeout(timer));
}

// A write (add/drop, lineup, claim, trade…) fires invalidateCaches; clear the device read cache too, so
// the next fan-out re-fetches from MFL rather than serving pre-action rosters — mirrors the backend's
// invalidate-on-write and the screen-cache's markAllStale.
onCacheInvalidate(() => deviceReadCache.clear());

// Can we even attempt a device read right now? (flag on + not in the post-offline cooldown + a backend
// that handed us the cookie). The cooldown check is first + sync, so during a network outage we skip the
// device entirely — no SecureStore read, no doomed fetch — and go straight to the backend (U-3).
export async function deviceReadsReady() {
  if (!DEVICE_READS || deviceHealth.deviceSuppressed()) return false;
  const creds = await loadMflCreds();
  return !!(creds && creds.cookie && creds.host && creds.season);
}

// Run one shared read descriptor straight from MFL on-device (creds from SecureStore). Throws if the
// flag/creds are missing or the fetch fails — every caller wraps this in a backend fallback.
async function runDeviceRead(descriptor, leagueId, params = {}) {
  const creds = await loadMflCreds();
  if (!DEVICE_READS || !creds || !creds.cookie || !creds.host || !creds.season) {
    throw new Error('device reads unavailable');
  }
  // Through the session read cache (type+league+params, TTL matched to the backend tier): concurrent
  // consumers of the same read share one fetch, and a remount within the TTL is a no-op rather than
  // re-firing an N-league fan-out. Cleared on any write (see onCacheInvalidate above).
  return deviceReadCache.get(descriptor.type, leagueId, params, () =>
    mflRead.readWith(fetchWithTimeout, {
      descriptor,
      host: creds.host,
      year: String(creds.season),
      league: leagueId,
      params,
      cookie: creds.cookie,
      // The registered User-Agent the backend handed us (A-3), so device reads send the same validated
      // client identity; fall back to the default only if an older handoff didn't include it.
      userAgent: creds.userAgent || 'DynastyCentral/1.0',
    })
  );
}

// Raw device-origin rosters for a league → shaped franchises ({ franchiseId, players:[{id,status}] }).
export async function deviceRosters(leagueId) {
  return (await runDeviceRead(mflRead.reads.rosters, leagueId)).map(mflRead.shapeRoster);
}

// Run a cross-league fan-out through the shared limiter (poolMap), paced to the SAME concurrency + stagger
// the backend runs (A-1). The backend hands the device its throttle envelope in the cookie creds
// (readConcurrency / readStaggerMs — 8 / 75ms with the registered API key); we mirror it so the device's
// own IP paces exactly like the registered backend, and a re-tune follows without an app rebuild. Falls back
// to poolMap's own defaults (the backend's unregistered 4 / 150ms floor) when an older handoff omitted them.
async function poolOpts() {
  const creds = await loadMflCreds();
  return {
    concurrency: creds && creds.readConcurrency ? creds.readConcurrency : undefined,
    staggerMs: creds && creds.readStaggerMs != null ? creds.readStaggerMs : undefined,
  };
}
async function devicePool(list, fn) {
  return poolMap(list, fn, await poolOpts());
}

// A-2 (partial-tolerant aggregates): run a cross-league fan-out that NEVER rejects on a single league's
// failure. Returns { fulfilled: successful fn() values, rejected: [{ item, error }] }. A single 429 then
// drops just that league (successes kept) instead of the old all-or-nothing Promise.all, which discarded
// every already-succeeded read AND made preferDevice re-run the FULL N-league backend fan-out (~2N reads
// on the shared IP, precisely under MFL stress). The caller sends only the fulfilled leagues; the backend
// aggregate fills or placeholders the dropped ones per its own policy (portfolio → marked placeholder +
// `partial` flag for U-1; drafts/lineups/picks → per-league backend read). Same concurrency/stagger as
// devicePool. If EVERYTHING fails, the caller throws so preferDevice does a clean whole-backend fallback.
async function settlePool(list, fn) {
  const outcomes = await poolMap(list, fn, { ...(await poolOpts()), settle: true });
  return {
    fulfilled: outcomes.filter((o) => o.ok).map((o) => o.value),
    rejected: outcomes.filter((o) => !o.ok).map((o) => ({ item: o.item, error: o.error })),
  };
}

// Best-effort, throttled cred refresh after an EXPIRED-cookie device failure (U-7): if the backend has
// since re-authed, the device catches up; if the backend's cookie is also dead, its reads fail and the app's
// normal session-expiry → re-login flow fires. Throttled so a burst of expired reads triggers ONE refresh.
let lastCredRefresh = 0;
const CRED_REFRESH_THROTTLE_MS = 60 * 1000;
function onCookieExpired() {
  const now = Date.now();
  if (now - lastCredRefresh < CRED_REFRESH_THROTTLE_MS) return;
  lastCredRefresh = now;
  refreshMflCreds().catch(() => {});
}

// Generic device-first fetcher: try the device path, fall back to the backend on any failure, tag the
// result with `_source`, and (when device reads are on) beacon the served path + its LATENCY + the
// fallback REASON for /_metrics. On a network failure it opens the offline cooldown (so the next reads skip
// the device — U-3) and suppresses the beacon (don't POST to a dead network); an expired cookie triggers a
// throttled cred refresh (U-7). DRYs the per-read wiring.
async function preferDevice(readName, deviceFn, backendFn) {
  let payload = null;
  let reason = null;
  let ms = null;
  if (await deviceReadsReady()) {
    const t0 = Date.now();
    try {
      payload = { ...(await deviceFn()), _source: 'device' };
      ms = Date.now() - t0;
    } catch (e) {
      reason = deviceHealth.classifyError(e); // device attempted → record why we're falling back
      if (reason === 'cookie_expired') onCookieExpired();
    }
  }
  deviceHealth.noteResult(payload ? null : reason); // a network failure opens the offline cooldown; a success clears it
  if (!payload) {
    const t0 = Date.now();
    payload = { ...(await backendFn()), _source: 'backend' };
    ms = Date.now() - t0;
  }
  // Beacon the served path + latency + reason + this build's shared-core (mflRead) VERSION (A-6) — but not
  // while we believe the network is down (it would just POST to a dead backend, U-3).
  if (DEVICE_READS && deviceHealth.shouldBeacon()) api.reportDeviceRead(readName, payload._source, { ms, reason, ver: mflRead.VERSION });
  return payload;
}

// Try the device path; on ANY failure fall back to the backend fn. Returns { data, source } so a
// caller can (optionally) show where the data came from. Never throws for a device-read failure alone.
export async function withDeviceFallback(deviceFn, backendFn) {
  try {
    const data = await deviceFn();
    return { data, source: 'device' };
  } catch (e) {
    return { data: await backendFn(), source: 'backend' };
  }
}

// The full league-teams payload (same shape as api.leagueTeams) built device-first: rosters straight
// from MFL on-device, enriched with the backend's global player dictionary + franchise directory. The
// heavy per-user rosters fan-out leaves the server; only the small, cached name/value data stays backend.
// assembleTeams throws if the result is incomplete, so a partial device read never renders.
export async function deviceLeagueTeams(leagueId) {
  const franchises = await deviceRosters(leagueId); // [{ franchiseId, players:[{id,status}] }]
  const ids = [...new Set(franchises.flatMap((f) => f.players.map((p) => p.id)))];
  const [dir, dict] = await Promise.all([api.franchiseDirectory(leagueId), api.playerLookup(ids, leagueId)]);
  return mflRead.assembleTeams(franchises, (dict && dict.players) || {}, dir);
}

// League Rosters, device-first (with the backend leagueTeams as fallback).
export function leagueTeamsPreferDevice(leagueId) {
  return preferDevice('rosters', () => deviceLeagueTeams(leagueId), () => api.leagueTeams(leagueId));
}

// League Standings, device-first: the leagueStandings export straight from MFL on-device + the backend
// franchise directory (names + playoff spots). assembleStandings throws if incomplete → backend fallback.
export async function deviceStandings(leagueId) {
  const [rows, dir] = await Promise.all([runDeviceRead(mflRead.reads.standings, leagueId), api.franchiseDirectory(leagueId)]);
  return mflRead.assembleStandings(rows, dir);
}
export function standingsPreferDevice(leagueId) {
  return preferDevice('standings', () => deviceStandings(leagueId), () => api.leagueStandings(leagueId));
}

// League Transactions, device-first: the transactions export straight from MFL on-device, enriched
// with the backend franchise directory (team names) + the global asset dictionary (player names AND
// draft-pick labels, resolved by /api/players/lookup for every id the feed references). The heavy
// per-user transactions fan-out leaves the server; only the small, cached name data stays backend.
// assembleTransactions throws on an empty directory (a failed fetch), so a nameless feed never renders.
export async function deviceTransactions(leagueId) {
  const rows = await runDeviceRead(mflRead.reads.transactions, leagueId);
  const parsed = mflRead.parseTransactions(rows);
  const ids = [...new Set(parsed.flatMap((t) => [...(t.addedIds || []), ...(t.droppedIds || [])]))];
  const [dir, dict] = await Promise.all([api.franchiseDirectory(leagueId), api.playerLookup(ids, leagueId)]);
  return mflRead.assembleTransactions(rows, (dict && dict.players) || {}, dir);
}
export function transactionsPreferDevice(leagueId) {
  return preferDevice('transactions', () => deviceTransactions(leagueId), () => api.leagueTransactions(leagueId));
}

// Cross-league exposure ("My Players"), device-first: fetch MY roster in EVERY league straight from MFL
// on-device — the per-user fan-out that trips the shared backend's per-IP limiter, here on the device's
// own IP — then enrich (name/value/age/availability/points/tag/watched) + group with the backend. Each
// league uses reads.rosters with FRANCHISE=me, the same LIGHT single-franchise read the backend uses; the
// shared assembleExposure does the cross-league grouping and throws on an empty enrichment dict → fallback.
export async function deviceExposure() {
  const { leagues } = await api.leaguesList();
  const list = (leagues || []).filter((l) => l && l.leagueId);
  if (!list.length) return { totalLeagues: 0, players: [], summary: { uniquePlayers: 0, multiLeague: 0 } };
  // FRANCHISE=me needs each league's franchise id; if any is missing we can't do the light read → fall back.
  if (list.some((l) => !l.franchiseId)) throw new Error('device exposure: a league is missing its franchise id');
  const perLeagueRosters = await devicePool(list, async (l) => {
    const franchises = (await runDeviceRead(mflRead.reads.rosters, l.leagueId, { FRANCHISE: l.franchiseId })).map(mflRead.shapeRoster);
    const mine = franchises.find((f) => String(f.franchiseId) === mflRead.fid(l.franchiseId)) || franchises[0] || { players: [] };
    return { leagueId: l.leagueId, name: l.name, players: mine.players };
  });
  const ids = [...new Set(perLeagueRosters.flatMap((r) => r.players.map((p) => p.id)))];
  const dict = await api.exposureEnrich(ids, list[0].leagueId);
  return mflRead.assembleExposure(perLeagueRosters, (dict && dict.players) || {}, list.length);
}
export function exposurePreferDevice() {
  return preferDevice('exposure', () => deviceExposure(), () => api.exposure());
}

// Cross-league portfolio dashboard, device-first: fetch every league's FULL rosters (all franchises —
// the backend needs them to rank roster strength) straight from MFL on-device, then hand them to the
// backend to aggregate (value/at-risk/holdings/history + the stores it owns). This moves the heavy
// all-franchise fan-out — the burst that trips the shared per-IP limiter — onto the device's own IP,
// while the aggregation (which reads/writes backend stores) stays server-side. All-or-nothing: any
// per-league read failure rejects → preferDevice falls back to the backend's own resilient fan-out.
export async function devicePortfolio() {
  const { leagues } = await api.leaguesList();
  const list = (leagues || []).filter((l) => l && l.leagueId);
  if (!list.length) return api.portfolio();
  // Partial-tolerant (A-2): send only the leagues that succeeded; the backend marks the rest as placeholders
  // and flags the total `partial` (surfaced by U-1). Only a TOTAL device failure falls back to the backend.
  const { fulfilled } = await settlePool(list, async (l) => [l.leagueId, await runDeviceRead(mflRead.reads.rosters, l.leagueId)]);
  if (!fulfilled.length) throw new Error('device portfolio: all leagues failed');
  return api.portfolioDevice(Object.fromEntries(fulfilled));
}
export function portfolioPreferDevice() {
  return preferDevice('portfolio', () => devicePortfolio(), () => api.portfolio());
}

// Cross-league draft overview, device-first: fetch every league's draftResults + calendar straight from
// MFL on-device (the fan-out behind "which drafts are live / scheduled / my turn"), then hand them to the
// backend to parse status/order/clock (that logic reads backend format/clock config, so it stays server-
// side). All-or-nothing: any per-league read failure rejects → preferDevice falls back to the backend.
export async function deviceDrafts() {
  const { leagues } = await api.leaguesList();
  const list = (leagues || []).filter((l) => l && l.leagueId);
  if (!list.length) return api.drafts();
  // Partial-tolerant (A-2): a league that fails on-device is simply not sent; the backend reads just that
  // league itself (per-league fallback), so the overview stays complete without discarding the successes.
  const { fulfilled } = await settlePool(list, async (l) => {
    const [draftResults, calendar] = await Promise.all([
      runDeviceRead(mflRead.reads.draftResults, l.leagueId),
      runDeviceRead(mflRead.reads.calendar, l.leagueId),
    ]);
    return [l.leagueId, { draftResults, calendar }];
  });
  if (!fulfilled.length) throw new Error('device drafts: all leagues failed');
  return api.draftsDevice(Object.fromEntries(fulfilled));
}
export function draftsPreferDevice() {
  return preferDevice('drafts', () => deviceDrafts(), () => api.drafts());
}

// Cross-league best-available free agents + the waivers overview: these are the only device reads that
// would fetch the FULL free-agent POOL (up to thousands of players PER league) straight from MFL. That's
// the one genuinely heavy device read — a real cellular-data + battery cost on a Sunday scramble — and,
// unlike the private per-user rosters/assets we do move, the free-agent pool is LEAGUE-shareable, so the
// backend's cross-user cache already serves it efficiently across a league's members. So we keep the pool
// BACKEND-only (docs/ARCHITECTURE_REVIEW_2026-07-device-origin.md A-10): fix the cost, don't gate the
// feature behind wifi (the PO's call — "check waivers from the parking lot" must work on cellular). The
// lighter per-user device reads (rosters/assets/draft) stay device-origin; only the heavy pool reverts.
// The wrappers keep their names + `format` passthrough so the screens/prefetch are unchanged; they simply
// resolve to the backend GET, which the value lens (?format=) still flows through.
export function bestAvailablePreferDevice(format) {
  return api.bestAvailable(format);
}
export function waiversOverviewPreferDevice() {
  return api.waiversOverview();
}

// Cross-league pick inventory, device-first: fetch each league's assets + futureDraftPicks + draftResults
// (the pick fan-out) on-device, then hand them to the backend to value/label/group (the pick-value model
// and franchise names stay backend). All-or-nothing: any per-league read failure falls back to the backend.
export async function devicePickInventory() {
  const { leagues } = await api.leaguesList();
  const list = (leagues || []).filter((l) => l && l.leagueId);
  if (!list.length) return api.pickInventory();
  // Partial-tolerant (A-2): failed leagues are omitted; the backend reads just those itself (per-league fallback).
  const { fulfilled } = await settlePool(list, async (l) => {
    const [assets, futureDraftPicks, draftResults] = await Promise.all([
      runDeviceRead(mflRead.reads.assets, l.leagueId),
      runDeviceRead(mflRead.reads.futureDraftPicks, l.leagueId),
      runDeviceRead(mflRead.reads.draftResults, l.leagueId),
    ]);
    return [l.leagueId, { assets, futureDraftPicks, draftResults }];
  });
  if (!fulfilled.length) throw new Error('device pick inventory: all leagues failed');
  return api.pickInventoryDevice(Object.fromEntries(fulfilled));
}
export function pickInventoryPreferDevice() {
  return preferDevice('pickInventory', () => devicePickInventory(), () => api.pickInventory());
}

// Home per-league triage, device-first: the roster (in-season lineup status / offseason dynasty summary)
// is the heavy per-user read; fetch it on-device and hand it to the backend, which keeps the trade/waiver/
// calendar items + the lineup engine. Per-league — matches the app's progressive Home load. The
// all-franchise rosters read shares its device-cache entry with Portfolio + the Rosters tab.
export async function deviceLeagueTriage(leagueId) {
  const franchises = await runDeviceRead(mflRead.reads.rosters, leagueId);
  return api.leagueTriageDevice(leagueId, franchises);
}
export function leagueTriagePreferDevice(leagueId) {
  return preferDevice('homeTriage', () => deviceLeagueTriage(leagueId), () => api.leagueTriage(leagueId));
}

// Lineups overview, device-first: each league's rosters (my roster + strength) is the per-user read;
// fetch on-device, the backend runs the optimizer (the projection + matchup reads stay backend).
export async function deviceLineups(mode) {
  const { leagues } = await api.leaguesList();
  const list = (leagues || []).filter((l) => l && l.leagueId);
  if (!list.length) return api.lineups(mode);
  // Partial-tolerant (A-2): failed leagues are omitted; the backend reads just those itself (per-league fallback).
  const { fulfilled } = await settlePool(list, async (l) => [l.leagueId, await runDeviceRead(mflRead.reads.rosters, l.leagueId)]);
  if (!fulfilled.length) throw new Error('device lineups: all leagues failed');
  return api.lineupsDevice(mode, Object.fromEntries(fulfilled));
}
export function lineupsPreferDevice(mode) {
  return preferDevice('lineups', () => deviceLineups(mode), () => api.lineups(mode));
}
