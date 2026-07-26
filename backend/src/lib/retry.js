'use strict';

// Retry a transient MFL read a few times before giving up. The read layer (lib/mfl.js) ALWAYS throws
// on a throttle (429/403) or a junk body and never returns a silent-empty object — and it only backs
// off 503s, not 429/403. So in a cross-league fan-out, a single rate-limited read throws; if the caller
// swallows that into an empty/placeholder result, it silently hides real data (a live draft, a pending
// trade offer, an imminent waiver window). Wrapping the read here re-issues it through the backend
// queue (which the adaptive penalty has already slowed), so a momentary throttle doesn't erase data.
// The read layer's own 503 backoff is separate and composes fine.
async function withRetry(fn, attempts = 3, baseDelayMs = 300) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = { withRetry };
