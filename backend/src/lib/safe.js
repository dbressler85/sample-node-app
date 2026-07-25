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

// Fan `fn` out across `leagues` concurrently, isolating each league's failure: a rejection (or a
// synchronous throw in `fn`) logs via logDegrade and yields the fallback for THAT league, so one
// league's hiccup never fails the whole cross-league aggregate. This is the fan-out form of safeCall —
// the `Promise.all(leagues.map((l) => fn(l).catch(() => x)))` shape was open-coded across read services,
// each re-implementing concurrency + per-league isolation and (usually) swallowing silently. `fn` gets
// (league, index). `fallback` is either a value or a `(league, index) => value` builder for a
// league-specific default (e.g. `[leagueId, null]`). `ctx` labels the log; the league id is appended.
async function mapLeagues(leagues, fn, fallback = null, ctx = 'mapLeagues') {
  const fb = typeof fallback === 'function' ? fallback : () => fallback;
  return Promise.all(
    (leagues || []).map((league, i) =>
      Promise.resolve()
        .then(() => fn(league, i))
        .catch((e) => {
          const id = (league && (league.leagueId || league.id)) || i;
          logDegrade(`${ctx} league=${id}`, e);
          return fb(league, i);
        })
    )
  );
}

module.exports = { safe, safeCall, logDegrade, mapLeagues };
