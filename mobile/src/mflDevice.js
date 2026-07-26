// Device-origin MFL reads (docs/DEVICE_ORIGIN_MFL.md). The transport half: build + fetch + parse a
// read straight from MFL using the SHARED read core (mflRead — identical to the backend's), with the
// user's cookie from SecureStore. mflRead.readWith enforces MFL's rules for us (429 = throw, no retry;
// registered User-Agent; credential in a header, never the URL). Everything here is gated behind the
// DEVICE_READS flag AND the presence of cached creds, and every consumer wraps it in a backend
// fallback, so a device-read hiccup is never user-visible.
import mflRead from './mflRead';
import { DEVICE_READS } from './config';
import { loadMflCreds } from './auth';
import { api } from './api';

// Can we even attempt a device read right now? (flag on + a backend that handed us the cookie)
export async function deviceReadsReady() {
  if (!DEVICE_READS) return false;
  const creds = await loadMflCreds();
  return !!(creds && creds.cookie && creds.host && creds.season);
}

// Run one shared read descriptor straight from MFL on-device (creds from SecureStore). Throws if the
// flag/creds are missing or the fetch fails — every caller wraps this in a backend fallback.
async function runDeviceRead(descriptor, leagueId) {
  const creds = await loadMflCreds();
  if (!DEVICE_READS || !creds || !creds.cookie || !creds.host || !creds.season) {
    throw new Error('device reads unavailable');
  }
  return mflRead.readWith(fetch, {
    descriptor,
    host: creds.host,
    year: String(creds.season),
    league: leagueId,
    cookie: creds.cookie,
    userAgent: 'DynastyCentral/1.0',
  });
}

// Raw device-origin rosters for a league → shaped franchises ({ franchiseId, players:[{id,status}] }).
export async function deviceRosters(leagueId) {
  return (await runDeviceRead(mflRead.reads.rosters, leagueId)).map(mflRead.shapeRoster);
}

// Generic device-first fetcher: try the device path, fall back to the backend on any failure, tag the
// result with `_source`, and (when device reads are on) beacon the served path for /_metrics. DRYs the
// per-read wiring.
async function preferDevice(readName, deviceFn, backendFn) {
  let payload = null;
  if (await deviceReadsReady()) {
    try { payload = { ...(await deviceFn()), _source: 'device' }; } catch (e) { /* fall back */ }
  }
  if (!payload) payload = { ...(await backendFn()), _source: 'backend' };
  if (DEVICE_READS) api.reportDeviceRead(readName, payload._source);
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
