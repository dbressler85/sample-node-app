'use strict';

// "Degrade, but don't go silent." A read-side fan-out that fails should still return a fallback (so
// one league's hiccup never 500s an aggregate), but it must not vanish without a trace: the codebase
// grew ~40 bare `.catch(() => [])` swallows that log NOTHING, so an expired cookie or an MFL 429 reads
// as "no data" instead of the actionable "re-login / rate-limited" the LESSONS rule requires
// ("always surface MFL's error detail, never just the status code").
//
// This is the instrumented version of that swallow. It is LOG-ONLY on the server: it does not change
// what the caller returns or what the user sees — the app's calm partial-degrade UX (C5) is unchanged.
// The value is operational visibility (a real Sunday failure shows up in the logs), not a new error
// surface. Two shapes:
//   const rows = await safe(mflRepo.something(...), [], 'picks.assets league=123');
//   const rows = await safeCall(() => mflRepo.something(...), [], 'picks.assets');   // defers the call

const mfl = require('./mfl');

function logDegrade(ctx, e) {
  const detail = (mfl && typeof mfl.errorDetail === 'function') ? mfl.errorDetail(e) : (e && e.message) || String(e);
  console.warn(`[degrade] ${ctx || 'read'}: ${detail}`);
}

// Await `promise`; on rejection log the MFL error detail with `ctx` and return `fallback`.
async function safe(promise, fallback, ctx) {
  try {
    return await promise;
  } catch (e) {
    logDegrade(ctx, e);
    return fallback;
  }
}

// Same, but takes a thunk so the call itself is inside the try (catches a synchronous throw too).
async function safeCall(fn, fallback, ctx) {
  try {
    return await fn();
  } catch (e) {
    logDegrade(ctx, e);
    return fallback;
  }
}

module.exports = { safe, safeCall, logDegrade };
