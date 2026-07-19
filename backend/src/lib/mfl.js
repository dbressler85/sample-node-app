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
// Serialize all outbound MFL requests and enforce a minimum gap between them.
let chain = Promise.resolve();
let lastRequestAt = 0;

function throttle(task) {
  const run = async () => {
    const wait = Math.max(0, lastRequestAt + config.mflMinRequestIntervalMs - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return task();
  };
  // Queue behind the previous request but don't let one failure break the chain.
  const result = chain.then(run, run);
  chain = result.catch(() => {});
  return result;
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

  const res = await throttle(() => fetch(url, init));
  const text = await res.text();

  if (!res.ok) {
    const err = new Error(`MFL request failed (${res.status}) for ${command}?TYPE=${params.TYPE || ''}`);
    err.status = res.status;
    err.body = text.slice(0, 500);
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

// Read data via the export command.
function exportRequest(type, { host = config.apiHost, cookie = null, ...params } = {}) {
  return rawRequest({ host, command: 'export', params: { TYPE: type, ...params }, cookie });
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
  toArray,
  hostFromLeagueUrl,
};
