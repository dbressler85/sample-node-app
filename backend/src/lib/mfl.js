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
const waiters = []; // queued resolve() callbacks waiting for a slot

function pumpThrottle() {
  while (active < config.mflMaxConcurrent && waiters.length) {
    const grant = waiters.shift();
    active += 1;
    // Stagger each granted start by the min interval (accumulating), so even a
    // burst of grants spreads out rather than firing simultaneously.
    const now = Date.now();
    const startAt = Math.max(now, lastStartAt + config.mflMinRequestIntervalMs);
    lastStartAt = startAt;
    const delay = startAt - now;
    if (delay > 0) setTimeout(grant, delay);
    else grant();
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

function buildUrl(host, command, params) {
  const url = new URL(`https://${host}/${config.season}/${command}`);
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    url.searchParams.set(key, String(val));
  }
  url.searchParams.set('JSON', '1');
  if (config.apiKey) url.searchParams.set('APIKEY', config.apiKey);
  return url.toString();
}

async function rawRequest({ host, command, params, cookie, method = 'GET', body }) {
  const url = buildUrl(host, command, params);
  const headers = { 'User-Agent': config.userAgent, Accept: 'application/json' };
  if (cookie) headers.Cookie = `MFL_USER_ID=${cookie}`;

  const init = { method, headers, redirect: 'follow' };
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = body;
  }

  // MFL rate-limits bursts with 429 (and occasionally 503). Retry with backoff,
  // honoring Retry-After, before giving up.
  let res;
  let text;
  for (let attempt = 0; ; attempt++) {
    res = await throttle(() => fetch(url, init));
    if ((res.status === 429 || res.status === 503) && attempt < config.mflMaxRetries) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(10000, 800 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, waitMs));
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
const readCache = new Map(); // key -> { at, promise }

// Slow-changing data gets a long TTL; live-polled data a very short one so it
// keeps up with its poll cadence; everything else a moderate short one.
const STATIC_TYPES = new Set(['league', 'rules', 'myleagues', 'players', 'nflSchedule', 'calendar']);
const LIVE_TYPES = new Set(['liveScoring', 'draftResults']);

// Read data via the export command (cached, TTL depends on how volatile it is).
async function exportRequest(type, { host = config.apiHost, cookie = null, ...params } = {}) {
  const key = `${cookie || ''}|${host}|${type}|${JSON.stringify(params)}`;
  const ttl = STATIC_TYPES.has(type)
    ? config.mflStaticTtlMs
    : LIVE_TYPES.has(type)
    ? config.mflLiveTtlMs
    : config.mflCacheTtlMs;
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;

  const promise = rawRequest({ host, command: 'export', params: { TYPE: type, ...params }, cookie });
  const entry = { at: Date.now(), promise };
  readCache.set(key, entry);
  // A failed read must not be cached: drop it so the next call retries.
  promise.catch(() => {
    if (readCache.get(key) === entry) readCache.delete(key);
  });
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
  const snippet = text.slice(0, 200).replace(/\s+/g, ' ').trim();
  // Logged to the server console (Render logs). Never logs the password.
  console.log(`[MFL login] status=${res.status} setCookie=${setCookie ? 'present' : 'none'} bodyLen=${text.length} body="${snippet}"`);

  const cookie = extractMflUserId(setCookie) || extractMflUserId(text);
  if (cookie) return cookie;

  let hint;
  if (/invalid|incorrect|wrong|denied|password/i.test(text)) hint = 'MFL rejected the username/password.';
  else if (/<html|<!doctype/i.test(text)) hint = 'MFL returned a web page, not an API response — this server IP may be blocked, or an MFL API key is required.';
  else if (res.status >= 500) hint = 'MFL had a server error; try again shortly.';
  else hint = 'No session cookie was returned.';

  const err = new Error(`MFL login failed (HTTP ${res.status}). ${hint}`);
  err.status = 401;
  err.detail = snippet;
  throw err;
}

// Extract a league's numbered host from the url MFL returns in `myleagues`.
// e.g. "https://www55.myfantasyleague.com/2026/home/64097" -> "www55.myfantasyleague.com"
function hostFromLeagueUrl(leagueUrl) {
  try {
    return new URL(leagueUrl).host;
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
  hostFromLeagueUrl,
};
