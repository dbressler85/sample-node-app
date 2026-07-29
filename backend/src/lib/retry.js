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

// Retry policy for MFL WRITES (imports / misc commands). Unlike a read, a write must NOT be re-issued
// on an ambiguous failure — a timeout or a 5xx that arrives AFTER MFL already processed the write could
// double-submit (a second trade proposal, a duplicate waiver bid). But a 429 is different: MFL rejects a
// throttled request BEFORE processing it (per lib/mfl.js), so nothing was created and re-issuing is safe.
// So retry writes ONLY on a 429 throttle and rethrow every other error immediately. (503 is already
// retried inside the transport.) This lets every write survive a transient throttle without risking a
// duplicate — the gap that surfaced a raw "(429)" and lost a draft pick / claim on a busy pipe.
async function withWriteRetry(fn, attempts = 3, baseDelayMs = 700) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // Only a rate-limit rejection is safe to re-issue; anything else may already have been applied.
      if (e && e.status === 429 && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

module.exports = { withRetry, withWriteRetry };
