// Device-origin MFL reads (docs/DEVICE_ORIGIN_MFL.md). The transport half: build + fetch + parse a
// read straight from MFL using the SHARED read core (mflRead — identical to the backend's), with the
// user's cookie from SecureStore. mflRead.readWith enforces MFL's rules for us (429 = throw, no retry;
// registered User-Agent; credential in a header, never the URL). Everything here is gated behind the
// DEVICE_READS flag AND the presence of cached creds, and every consumer wraps it in a backend
// fallback, so a device-read hiccup is never user-visible.
import mflRead from './mflRead';
import { DEVICE_READS } from './config';
import { loadMflCreds } from './auth';

// Can we even attempt a device read right now? (flag on + a backend that handed us the cookie)
export async function deviceReadsReady() {
  if (!DEVICE_READS) return false;
  const creds = await loadMflCreds();
  return !!(creds && creds.cookie && creds.host && creds.season);
}

// Raw device-origin rosters for a league → shaped franchises ({ franchiseId, players:[{id,status}] }).
// Throws if the flag/creds are missing or the fetch fails — the caller falls back to the backend.
export async function deviceRosters(leagueId) {
  const creds = await loadMflCreds();
  if (!DEVICE_READS || !creds || !creds.cookie || !creds.host || !creds.season) {
    throw new Error('device reads unavailable');
  }
  const franchises = await mflRead.readWith(fetch, {
    descriptor: mflRead.reads.rosters,
    host: creds.host,
    year: String(creds.season),
    league: leagueId,
    cookie: creds.cookie,
    userAgent: 'DynastyCentral/1.0',
  });
  return franchises.map(mflRead.shapeRoster);
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
