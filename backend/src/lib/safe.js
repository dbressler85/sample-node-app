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
function leagueIdOf(league, i) {
  return (league && (league.leagueId || league.id)) || i;
}

async function mapLeagues(leagues, fn, fallback = null, ctx = 'mapLeagues') {
  const fb = typeof fallback === 'function' ? fallback : () => fallback;
  return Promise.all(
    (leagues || []).map((league, i) =>
      Promise.resolve()
        .then(() => fn(league, i))
        .catch((e) => {
          logDegrade(`${ctx} league=${leagueIdOf(league, i)}`, e);
          return fb(league, i);
        })
    )
  );
}

// Like mapLeagues, but instead of collapsing a failure to a fallback VALUE it returns a settled
// ENVELOPE per league: [{ leagueId, ok, value, error }]. The distinction is the whole point:
//   ok:false            → fn actually threw (a real throttle / expired-cookie failure)
//   ok:true, value:null → the league loaded fine and simply has nothing (an offseason scoreboard,
//                          an inbox with no offers, a bye week)
// A fan-out that collapses both to `null` (the mapLeagues + `.filter(Boolean)` shape) can't tell a
// dropped league from an empty one, so it either under-reports coverage or fires a FALSE `partial` in
// the offseason. The envelope lets an aggregate compute leaguesLoaded/partial from GENUINE failures.
// Still isolates + logs each failure exactly like mapLeagues. `fn` gets (league, index).
async function mapLeaguesSettled(leagues, fn, ctx = 'mapLeaguesSettled') {
  return Promise.all(
    (leagues || []).map((league, i) =>
      Promise.resolve()
        .then((/* */) => fn(league, i))
        .then((value) => ({ leagueId: leagueIdOf(league, i), ok: true, value, error: null }))
        .catch((e) => {
          const id = leagueIdOf(league, i);
          logDegrade(`${ctx} league=${id}`, e);
          return { leagueId: id, ok: false, value: null, error: e };
        })
    )
  );
}

// Roll a mapLeaguesSettled result into the standard partial-load honesty envelope every aggregate
// exposes: { partial, leaguesLoaded, leagueCount }. `leaguesLoaded` counts leagues whose read
// SUCCEEDED (whether or not the value was empty) — it answers "did we reach all your leagues," which
// is the honest basis for "N of M loaded", not "how many had data". So the standard consumer shape is:
//   const settled = await mapLeaguesSettled(leagues, fn, ctx);
//   const values = settled.filter((s) => s.ok && s.value).map((s) => s.value);
//   return { ...partiality(settled), items: values };
function partiality(settled) {
  const rows = settled || [];
  const leaguesLoaded = rows.filter((s) => s && s.ok).length;
  return { partial: leaguesLoaded < rows.length, leaguesLoaded, leagueCount: rows.length };
}

module.exports = { safe, safeCall, logDegrade, mapLeagues, mapLeaguesSettled, partiality };
