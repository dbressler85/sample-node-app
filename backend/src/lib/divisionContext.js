'use strict';

// "Multi-copy" league detection + division scoping.
//
// Almost every MyFantasyLeague league is a SINGLE shared player pool: a given NFL player is on at
// most one roster league-wide, and each owner runs one franchise. A handful of leagues are set up
// as MULTI-COPY (a.k.a. "multi-division shared pool"): a single league hosts several DIVISIONS, and
// each division is its OWN independent player universe — so the same NFL player can be rostered by
// one franchise in EVERY division at once. That breaks two assumptions the app leans on everywhere:
//   1. "a player is rostered by ≤1 franchise league-wide" → every all-franchise scan (strength,
//      standings, opponent rosters) double/triple-counts and mixes divisions.
//   2. "availability is league-wide" → a player rostered in another division reads as unavailable
//      in yours, even though he's a legitimate free agent for your team.
//
// This module answers, per league: is it multi-copy, and if so which division is MINE, so callers
// can scope an all-franchise view (or an availability check) to just my division.
//
// SAFETY CONTRACT — a normal divisioned league must never be affected:
//   * `multiCopy` is NEVER inferred from "has divisions". Normal leagues use divisions purely for
//     scheduling and stay multiCopy:false. The ONLY signal that flips it true is hard evidence of a
//     shared pool: the SAME playerId rostered across ≥2 divisions at once (impossible in a
//     single-copy league, where a player is on exactly one roster).
//   * Threshold, not tripwire: a real multi-copy league duplicates ~the whole pool across divisions,
//     so we require a large SHARE of rostered players to appear in >1 division. One stray duplicate
//     (a mid-trade blip, a data glitch) can never flip a normal league.
//   * Fail to false: a missing `division` attribute, a throttled/parse-failed read, <2 divisions, or
//     an unresolved "my division" all degrade to multiCopy:false → today's exact behavior. The
//     unsafe direction (wrongly scoping a normal league) is the one we disable.
// Every consumer treats multiCopy:false as a pure no-op, so when detection says "normal league" the
// code path is byte-for-byte what it is today.

const config = require('../config');
const mfl = require('./mfl');
const mflRepo = require('./mflRepo');
const { createMemo } = require('./memo');

// Divisions/multi-copy status are SEASON-STABLE (a franchise's division and the shared-pool shape don't
// change with roster moves), so cache on the long static TTL — not the 5m read TTL. This matters: the
// ≥2-division branch of build() reads the full `rosters` export to detect a shared pool, so a short TTL
// re-issued that heavy read (40 franchises for a multi-copy league) every 5m across /standings,
// /dashboard and the portfolio. A login switch uses a different cookie (a different memo key), and a
// build that couldn't read rosters THROWS rather than caching a false — so a real multi-copy league is
// never pinned to multiCopy:false for the long TTL by one throttled read.
const ctxMemo = createMemo({ ttlMs: config.mflStaticTtlMs });

// Minimum share of DISTINCT rostered players that must appear in more than one division for a league
// to count as multi-copy. A real multi-copy league duplicates the entire pool (share ≈ 1.0); a normal
// divisioned league duplicates none (share = 0). 0.25 sits far from both, so neither a normal league
// nor a handful of transient duplicates can cross it.
const MULTICOPY_MIN_SHARE = 0.25;

// A division id per franchise, read from the `league` export's franchise directory. `division` is a
// franchise attribute (absent entirely when the league has no divisions). Robust to MFL's attribute
// naming via mfl.attr.
function divisionOf(fr) {
  const d = mfl.text(mfl.attr(fr, 'division')).trim();
  return d || null;
}

// PURE detection core — no I/O, so it's directly unit-testable. Given the franchise→division map and
// the raw `rosters` franchise array, decide whether the SAME player is rostered across ≥2 divisions
// for a large enough share of the pool. Returns { multiCopy, crossDivision, distinctPlayers, share }.
function detect(franchiseDivision, rosterFranchises) {
  const divisions = new Set([...franchiseDivision.values()].filter((d) => d != null));
  if (divisions.size < 2 || !Array.isArray(rosterFranchises) || !rosterFranchises.length) {
    return { multiCopy: false, crossDivision: 0, distinctPlayers: 0, share: 0 };
  }
  const playerDivs = new Map(); // playerId -> Set(division)
  for (const f of rosterFranchises) {
    const div = franchiseDivision.get(mfl.fid(mfl.text(f && f.id)));
    if (div == null) continue; // a franchise we can't place in a division can't prove duplication
    for (const p of mfl.toArray(f && f.player)) {
      const pid = mfl.text(p && p.id);
      if (!pid) continue;
      let set = playerDivs.get(pid);
      if (!set) { set = new Set(); playerDivs.set(pid, set); }
      set.add(div);
    }
  }
  const distinctPlayers = playerDivs.size;
  const crossDivision = [...playerDivs.values()].filter((s) => s.size >= 2).length;
  const share = distinctPlayers ? crossDivision / distinctPlayers : 0;
  return { multiCopy: share >= MULTICOPY_MIN_SHARE, crossDivision, distinctPlayers, share };
}

// Wrap a resolved determination in a small context with an `includes(franchiseId)` predicate:
//   * NON multi-copy → includes() is always true (no scoping; every franchise stays in view).
//   * multi-copy      → includes() is true only for franchises in MY division.
function makeContext({ multiCopy, myDivision, franchiseDivision }) {
  const fd = franchiseDivision || new Map();
  return {
    multiCopy: !!multiCopy,
    myDivision: myDivision || null,
    divisionCount: new Set([...fd.values()].filter((d) => d != null)).size,
    franchiseDivision: fd,
    divisionOf: (fid) => fd.get(mfl.fid(String(fid))) || null,
    includes(fid) {
      if (!multiCopy) return true;
      const d = fd.get(mfl.fid(String(fid)));
      return d != null && d === myDivision;
    },
  };
}

const OFF = () => makeContext({ multiCopy: false, myDivision: null, franchiseDivision: new Map() });

async function build(cookie, league, prefetchedFranchises) {
  // Franchise directory (with division attrs) — cheap and cached (static `league` export).
  const franchiseRows = await mflRepo.leagueFranchises(league, cookie).catch(() => []);
  const franchiseDivision = new Map();
  for (const fr of franchiseRows) {
    const id = mfl.fid(mfl.text(fr && fr.id));
    if (id) franchiseDivision.set(id, divisionOf(fr));
  }
  const myDivision = franchiseDivision.get(mfl.fid(String(league.franchiseId))) || null;
  const divisions = new Set([...franchiseDivision.values()].filter((d) => d != null));
  // Fast path: no real division structure (or we can't place my own franchise) → never multi-copy,
  // and crucially NO roster read. Normal leagues pay nothing here.
  if (divisions.size < 2 || myDivision == null) {
    // The common case (a normal / single-division league) — no roster read, no log (this ran for every
    // normal league on every cold load).
    return makeContext({ multiCopy: false, myDivision, franchiseDivision });
  }
  // ≥2 divisions: we need rosters to tell a shared pool from a normal divisioned league. Reuse the
  // caller's already-fetched rosters when provided; otherwise one `rosters` read.
  const rosterFranchises = prefetchedFranchises || (await mflRepo.rosters(league, cookie).catch(() => null));
  if (!Array.isArray(rosterFranchises) || !rosterFranchises.length) {
    // Couldn't read rosters → we can't tell a shared pool from a normal divisioned league. THROW so the
    // memo drops it (createMemo never caches a rejection) and the next read retries — otherwise a single
    // throttled read would pin a real multi-copy league to multiCopy:false for the whole (now long) TTL.
    // Every caller .catch()es resolve to a safe non-scoping context, so this degrades one request only.
    throw new Error(`divisionContext: rosters unavailable for league ${league.leagueId} (${divisions.size} divisions) — not caching`);
  }
  const det = detect(franchiseDivision, rosterFranchises);
  // Log the detection evidence only for a genuine ≥2-division league (rare), so a shared-pool league that
  // trips — or fails to trip — the threshold stays legible without spamming a line per normal league.
  console.log(`[divisionContext] league=${league.leagueId} divisions=${divisions.size} myDivision=${myDivision} rosterFranchises=${rosterFranchises.length} distinctPlayers=${det.distinctPlayers} crossDivision=${det.crossDivision} share=${det.share.toFixed(3)} threshold=${MULTICOPY_MIN_SHARE} → multiCopy=${det.multiCopy}`);
  return makeContext({ multiCopy: det.multiCopy, myDivision, franchiseDivision });
}

// Resolve (and cache) the division context for a league. `franchises` (optional) is the raw `rosters`
// export array if the caller already has it — passed through to detection to avoid a second read.
async function resolve(cookie, league, franchises = null) {
  if (!league) return OFF();
  // Demo mode models a single shared pool with no divisions — always a no-op, so the demo smoke and
  // every demo-backed test are unaffected. Detection itself is covered by unit tests over `detect`.
  if (config.demoMode) return OFF();
  return ctxMemo.get(`${cookie}|${league.leagueId}`, () => build(cookie, league, franchises));
}

function invalidate(cookie, leagueId) {
  ctxMemo.invalidate(`${cookie}|${leagueId}`);
}

module.exports = { resolve, invalidate, detect, makeContext, MULTICOPY_MIN_SHARE };
