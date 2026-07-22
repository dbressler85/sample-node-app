'use strict';

// Low-level MyFantasyLeague API client.
//
// MFL exposes a request-per-TYPE API documented at:
//   https://api.myfantasyleague.com/2020/api_info?STATE=details
//
// Two commands matter:
//   export  -> read data   (protocol://host/year/export?TYPE=...&JSON=1)
//   import  -> write data   (protocol://host/year/import?TYPE=...)
//
// Important operational details this client handles:
//  * Auth is a login cookie (MFL_USER_ID) obtained once and reused across leagues.
//  * Each league lives on a numbered host (www42, www55, ...). Account-level calls
//    (login, myleagues, players) go to api.myfantasyleague.com; league calls must
//    go to that league's own host, or MFL redirects/errors.
//  * MFL throttles clients and blocks generic user agents, so we set a descriptive
//    User-Agent and serialize requests with a minimum interval between them.

const config = require('../config');

// --- request throttle -------------------------------------------------------
// Run up to mflMaxConcurrent outbound MFL requests at once, with a small stagger
// between starts so we don't burst. This replaces strict serialization: cold
// first-load fans out many per-league reads, and serializing them at a big gap
// dominated latency. Concurrency is bounded (polite + caps blast radius) and the
// 429/503 backoff in rawRequest is the safety net if MFL rate-limits.
let active = 0;
let lastStartAt = 0;
let penaltyUntil = 0; // while > now, the pipe runs in gentle mode after a rate-limit
let wakePending = false; // at most one pending timer to re-pump when a penalty lifts
const waiters = []; // queued resolve() callbacks waiting for a slot

function inPenalty() {
  return Date.now() < penaltyUntil;
}

// Adaptive backoff: the FIRST 429/503 in a burst trips a cooldown window so the REST of the
// burst automatically halves its concurrency and quadruples its stagger, instead of every
// remaining request piling onto an already rate-limited MFL and cascading more 429s. This is
// what makes a cold 15-league fan-out (waivers overview, portfolio) survive without a league
// card erroring out. The window is at least the server's Retry-After.
function noteRateLimit(waitMs) {
  penaltyUntil = Math.max(penaltyUntil, Date.now() + Math.max(waitMs || 0, config.mflMinRequestIntervalMs * 8));
}
function effConcurrent() {
  return inPenalty() ? Math.max(1, Math.floor(config.mflMaxConcurrent / 2)) : config.mflMaxConcurrent;
}
function effInterval() {
  return inPenalty() ? config.mflMinRequestIntervalMs * 4 : config.mflMinRequestIntervalMs;
}

function pumpThrottle() {
  while (active < effConcurrent() && waiters.length) {
    const grant = waiters.shift();
    active += 1;
    // Stagger each granted start by the min interval (accumulating), so even a
    // burst of grants spreads out rather than firing simultaneously.
    const now = Date.now();
    const startAt = Math.max(now, lastStartAt + effInterval());
    lastStartAt = startAt;
    const delay = startAt - now;
    if (delay > 0) setTimeout(grant, delay);
    else grant();
  }
  // If we're holding requests back only because of the penalty, wake the pump when it
  // lifts so the queue drains promptly instead of waiting on the next completion.
  if (!wakePending && waiters.length && active < config.mflMaxConcurrent && inPenalty()) {
    wakePending = true;
    const wake = Math.max(5, penaltyUntil - Date.now() + 5);
    setTimeout(() => { wakePending = false; pumpThrottle(); }, wake);
  }
}

async function throttle(task) {
  await new Promise((resolve) => {
    waiters.push(resolve);
    pumpThrottle();
  });
  try {
    return await task();
  } finally {
    active -= 1;
    pumpThrottle();
  }
}

// Normalize MFL's inconsistent shapes: a collection with one element is returned
// as an object, with many as an array. Callers always want an array.
function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// Read an MFL attribute by any of several candidate names, matching
// case- AND underscore-insensitively. MFL's attribute naming is inconsistent
// across (and within) export types — pendingTrades returns `offeredto` lowercase
// but `will_give_up` / `will_receive` snake_case — so a single literal key misses.
// Pass every plausible spelling; the first present key wins.
function attr(obj, ...names) {
  if (!obj || typeof obj !== 'object') return undefined;
  const want = new Set(names.map((n) => String(n).toLowerCase().replace(/_/g, '')));
  for (const key of Object.keys(obj)) {
    if (want.has(key.toLowerCase().replace(/_/g, ''))) return obj[key];
  }
  return undefined;
}

// SSRF guard: outbound hosts come from MFL data (a league's `url` in the myleagues export),
// so a compromised/MITM'd MFL response — or a crafted league — could otherwise point requests
// at an internal address. Every outbound URL (and every redirect hop) must be an MFL host.
const MFL_HOST_RE = /(^|\.)myfantasyleague\.com$/i;
function isMflHost(host) {
  return MFL_HOST_RE.test(String(host || '').split(':')[0]);
}

function buildUrl(host, command, params) {
  // Defence in depth: `host` is already sanitized at its source (hostFromLeagueUrl falls back
  // to the MFL apiHost for anything non-MFL), so this never fires in normal operation — it just
  // guarantees we can't be tricked into building a request to a non-MFL host.
  if (!isMflHost(host)) {
    const err = new Error(`Refusing to build a request to a non-MyFantasyLeague host: ${host}`);
    err.status = 502;
    throw err;
  }
  const url = new URL(`https://${host}/${config.season}/${command}`);
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    url.searchParams.set(key, String(val));
  }
  url.searchParams.set('JSON', '1');
  if (config.apiKey) url.searchParams.set('APIKEY', config.apiKey);
  return url.toString();
}

// fetch() with redirects followed MANUALLY so each hop's host is re-validated against the MFL
// allowlist — closes the redirect-based SSRF bypass that `redirect:'follow'` leaves open (an
// allowlisted host that 302s to an internal address). MFL's JSON API returns responses directly,
// so in normal operation this follows zero redirects; the loop is a safety net, not a hot path.
async function fetchAllowlisted(startUrl, init) {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const host = new URL(current).host;
    if (!isMflHost(host)) {
      const err = new Error(`Refusing to follow a request to a non-MyFantasyLeague host: ${host}`);
      err.status = 502;
      throw err;
    }
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    return res;
  }
  const err = new Error('Too many MFL redirects');
  err.status = 502;
  throw err;
}

async function rawRequest({ host, command, params, cookie, method = 'GET', body }) {
  const url = buildUrl(host, command, params);
  const headers = { 'User-Agent': config.userAgent, Accept: 'application/json' };
  if (cookie) headers.Cookie = `MFL_USER_ID=${cookie}`;

  const init = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = body;
  }

  // MFL rate-limits bursts with 429 (and occasionally 503). Retry with backoff,
  // honoring Retry-After, before giving up.
  let res;
  let text;
  for (let attempt = 0; ; attempt++) {
    res = await throttle(() => fetchAllowlisted(url, init));
    if ((res.status === 429 || res.status === 503) && attempt < config.mflMaxRetries) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(10000, 800 * 2 ** attempt);
      // Trip the global cooldown so the rest of an in-flight burst backs off too, and add a
      // little jitter so many requests that 429'd together don't retry in lockstep.
      noteRateLimit(waitMs);
      const jitter = Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, waitMs + jitter));
      continue;
    }
    text = await res.text();
    break;
  }

  if (!res.ok) {
    const err = new Error(`MFL request failed (${res.status}) for ${command}?TYPE=${params.TYPE || ''}`);
    err.status = res.status;
    err.body = text.slice(0, 500);
    if (res.status === 429) err.detail = 'MyFantasyLeague rate limit hit. Give it a moment and refresh.';
    throw err;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const err = new Error(`MFL returned non-JSON for ${command}?TYPE=${params.TYPE || ''}`);
    err.body = text.slice(0, 500);
    throw err;
  }

  // MFL reports API-level problems inside a 200 body, e.g. {"error":"Invalid Password"}.
  if (json && json.error) {
    const err = new Error(`MFL API error: ${json.error}`);
    err.mflError = json.error;
    throw err;
  }
  return json;
}

// Short-lived cache for export (read) responses. Many services build a single
// screen and would otherwise re-request the same league list / roster / scores;
// this collapses those into one call and makes pull-to-refresh cheap. We cache the
// in-flight PROMISE, not just the resolved value, so concurrent identical reads
// (e.g. Home fanning several endpoints at the same league's roster at once) share
// one network request instead of each firing their own.
const readCache = new Map(); // key -> { at, ttl, promise }
const READ_CACHE_MAX = 600; // bound memory: sweep expired entries once the map grows past this

// Slow-changing data gets a long TTL; live-polled data a very short one so it
// keeps up with its poll cadence; everything else a moderate short one.
const STATIC_TYPES = new Set(['league', 'rules', 'myleagues', 'players', 'nflSchedule', 'calendar']);
// liveScoring/draftResults are polled; pendingTrades isn't, but an incoming offer is
// an EXTERNAL event nothing invalidates, so a 5m cache made new offers lag on the
// inbox — keep it short so a pull-to-refresh actually surfaces them.
const LIVE_TYPES = new Set(['liveScoring', 'draftResults', 'pendingTrades']);
// Slow-changing scoring reads: weekly projections and past-week actuals. A player
// profile fans these across every league, so a longer TTL keeps profiles fast and
// avoids the rate-limit burst. (Current-week live scoring uses LIVE_TYPES instead.)
const SLOW_TYPES = new Set(['projectedScores', 'playerScores']);

// Read data via the export command (cached, TTL depends on how volatile it is).
async function exportRequest(type, { host = config.apiHost, cookie = null, maxAge = null, ...params } = {}) {
  const key = `${cookie || ''}|${host}|${type}|${JSON.stringify(params)}`;
  let ttl = STATIC_TYPES.has(type)
    ? config.mflStaticTtlMs
    : LIVE_TYPES.has(type)
    ? config.mflLiveTtlMs
    : SLOW_TYPES.has(type)
    ? config.mflSlowTtlMs
    : config.mflCacheTtlMs;
  // A caller can ask for a fresher-than-default read of a shared entry (e.g. the FAAB
  // balance inside the 1h `league` export). Only ever shortens the window, never
  // lengthens it, and the refetched value updates the shared cache for everyone.
  if (maxAge != null) ttl = Math.min(ttl, maxAge);
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;

  const promise = rawRequest({ host, command: 'export', params: { TYPE: type, ...params }, cookie });
  const entry = { at: Date.now(), ttl, promise };
  readCache.set(key, entry);
  // A failed read must not be cached: drop it so the next call retries.
  promise.catch(() => {
    if (readCache.get(key) === entry) readCache.delete(key);
  });
  // Bound memory: a key that's never re-requested (a past week's scores, a departed league)
  // would otherwise live for the process lifetime. When the map grows past the cap, sweep the
  // entries that are already past their own TTL (mirrors lib/memo.js).
  if (readCache.size > READ_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of readCache) if (now - v.at > v.ttl) readCache.delete(k);
  }
  return promise;
}

// Drop cached reads for one league (all its export types) after a write to it, so
// the next read reflects the change rather than serving a pre-write snapshot for
// the rest of the TTL. Scoped to the given cookie so it never touches another
// account's cache. `L` (leagueId) is part of every league-scoped export's params.
function invalidateLeague(cookie, leagueId) {
  const needleCookie = `${cookie || ''}|`;
  const needleL = `"L":"${String(leagueId)}"`;
  for (const k of readCache.keys()) {
    if (k.startsWith(needleCookie) && k.includes(needleL)) readCache.delete(k);
  }
}

// Write data via the import command (POST form-encoded).
function importRequest(type, { host = config.apiHost, cookie = null, ...params } = {}) {
  const form = new URLSearchParams({ TYPE: type });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) form.set(k, String(v));
  }
  return rawRequest({ host, command: 'import', params: { TYPE: type }, cookie, method: 'POST', body: form.toString() });
}

// Pull the MFL_USER_ID token out of a Set-Cookie header or a JSON/XML body.
// Handles: "MFL_USER_ID=abc; ...", '"MFL_USER_ID":"abc"', 'MFL_USER_ID="abc"'.
function extractMflUserId(str) {
  if (!str) return null;
  const m = /MFL_USER_ID["'=:\s]+([A-Za-z0-9%._-]{6,})/i.exec(str);
  return m ? decodeURIComponent(m[1]) : null;
}

// Authenticate once and return the MFL_USER_ID cookie value, reusable across leagues.
async function login(username, password) {
  // The login endpoint is special: XML=1 (not JSON), and no APIKEY needed here.
  const url = new URL(`https://${config.apiHost}/${config.season}/login`);
  url.searchParams.set('USERNAME', username);
  url.searchParams.set('PASSWORD', password);
  url.searchParams.set('XML', '1');
  if (config.apiKey) url.searchParams.set('APIKEY', config.apiKey);

  const res = await throttle(() =>
    fetch(url.toString(), { headers: { 'User-Agent': config.userAgent, Accept: '*/*' }, redirect: 'manual' })
  );

  const setCookie = res.headers.get('set-cookie') || '';
  let text = '';
  try {
    text = await res.text();
  } catch (e) {
    /* ignore */
  }
  // Log only non-sensitive shape. The body is NOT logged: on some MFL responses it
  // carries the session cookie / user id (that's why extractMflUserId reads it below),
  // and these lines land in Render's logs.
  console.log(`[MFL login] status=${res.status} setCookie=${setCookie ? 'present' : 'none'} bodyLen=${text.length}`);

  const cookie = extractMflUserId(setCookie) || extractMflUserId(text);
  if (cookie) return cookie;

  let hint;
  if (/invalid|incorrect|wrong|denied|password/i.test(text)) hint = 'MFL rejected the username/password.';
  else if (/<html|<!doctype/i.test(text)) hint = 'MFL returned a web page, not an API response — this server IP may be blocked, or an MFL API key is required.';
  else if (res.status >= 500) hint = 'MFL had a server error; try again shortly.';
  else hint = 'No session cookie was returned.';

  // The friendly hint is already in the message (which the client sees). Deliberately do NOT
  // attach MFL's raw login-response body to err.detail — the central handler echoes err.detail
  // to the client, and echoing an upstream body back is a needless info-leak. Keep the raw text
  // server-side only (logged above as shape) for debugging.
  const err = new Error(`MFL login failed (HTTP ${res.status}). ${hint}`);
  err.status = 401;
  throw err;
}

// Extract a league's numbered host from the url MFL returns in `myleagues`.
// e.g. "https://www55.myfantasyleague.com/2026/home/64097" -> "www55.myfantasyleague.com"
function hostFromLeagueUrl(leagueUrl) {
  try {
    const host = new URL(leagueUrl).host;
    // Only trust an MFL host from the (data-derived) league url; anything else falls back to the
    // canonical apiHost so a hostile url can never seed an outbound request to a foreign address.
    return isMflHost(host) ? host : config.apiHost;
  } catch (e) {
    return config.apiHost;
  }
}

module.exports = {
  login,
  exportRequest,
  importRequest,
  invalidateLeague,
  toArray,
  attr,
  hostFromLeagueUrl,
  // Test-only window into the adaptive throttle (see throttle-test / throttle-backoff-test).
  __throttle: { inPenalty, effConcurrent, effInterval },
};
