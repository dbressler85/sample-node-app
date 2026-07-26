'use strict';

// Device-origin health: how a device-read failure is CLASSIFIED, plus a short OFFLINE COOLDOWN so a dead
// network (the subway scenario, U-3) doesn't make every screen re-attempt a doomed device fetch (slow) or
// beacon-storm a backend it can't reach. Also distinguishes an EXPIRED MFL cookie (U-7) from a missing one,
// so the app can react (refresh creds) instead of silently falling back for hours. Pure + injectable clock
// so the logic is unit-tested off-device.

// After a network failure we believe the device is offline; skip device reads (go straight to the backend,
// which the on-device cache/C4 covers) for this long, so a subway ride isn't N slow device attempts.
const OFFLINE_COOLDOWN_MS = 15 * 1000;

// Coarse buckets matched to the errors the device path throws. 401/403 = the MFL cookie was REJECTED
// (expired) — kept DISTINCT from a missing cookie (no_creds), so U-7 can refresh creds and /_metrics can
// show "device cookie expired" rather than lumping it into a generic error.
function classifyError(e) {
  if (!e) return 'error';
  if (e.status === 429) return 'rate_limited';
  if (e.status === 401 || e.status === 403) return 'cookie_expired';
  const m = String(e.message || '').toLowerCase();
  if (/unavailable|cred|cookie/.test(m)) return 'no_creds'; // flag off or no cached cookie
  if (/empty|incomplete|directory|falling back/.test(m)) return 'incomplete'; // an assemble threw
  if (/reach|network|timeout|abort|fetch/.test(m)) return 'network'; // offline / DNS / our fetch timeout
  if (Number.isFinite(e.status) && e.status >= 400) return `http_${e.status}`;
  return 'error';
}

let offlineUntil = 0;

// Record the outcome of a device read. A `network` failure opens the offline cooldown; a success (reason
// null/undefined) closes it early so we resume device reads the moment connectivity is back.
function noteResult(reason, nowMs = Date.now()) {
  if (reason === 'network') offlineUntil = nowMs + OFFLINE_COOLDOWN_MS;
  else if (!reason) offlineUntil = 0;
}

// Are we in the post-network-failure cooldown? While true, callers skip the device attempt and go straight
// to the backend — fast, no doomed device fetch (U-3).
function deviceSuppressed(nowMs = Date.now()) {
  return nowMs < offlineUntil;
}

// Don't fire the metrics beacon while we believe the network is down — it would just POST to a dead backend
// (beacon-storm). Resumes automatically once the cooldown lapses.
function shouldBeacon(nowMs = Date.now()) {
  return nowMs >= offlineUntil;
}

function _reset() { offlineUntil = 0; }

module.exports = { classifyError, noteResult, deviceSuppressed, shouldBeacon, OFFLINE_COOLDOWN_MS, _reset };
