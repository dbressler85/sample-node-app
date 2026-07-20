'use strict';

// League discovery: the "one login -> all my leagues" magic.
// MFL's `myleagues` returns every league the authenticated account belongs to,
// including that account's franchise id and the league's host url.

const mfl = require('../lib/mfl');
const config = require('../config');
const demo = require('../demo/fixtures');
const leaguePrefs = require('../store/leaguePrefs');

function normalize(l) {
  const url = l.url || '';
  return {
    leagueId: String(l.league_id),
    name: l.name || `League ${l.league_id}`,
    url,
    host: mfl.hostFromLeagueUrl(url),
    franchiseId: l.franchise_id ? String(l.franchise_id) : null,
    franchiseName: l.franchise_name || null,
  };
}

// Both `myleagues` and a league's franchise names are effectively static within a
// session, yet they're read on nearly every request — listLeagues alone from 20+
// call sites, often several times per request flow, and franchiseNames from inside
// per-league loops. Uncached, a single cross-league screen fanned out into dozens
// of redundant MFL round-trips (the dominant latency cost). Cache both on the
// static TTL, keyed by cookie (+ leagueId), so repeat reads are free. Demo mode
// bypasses entirely.
const leaguesCache = new Map(); // cookie -> { at, leagues }
const namesCache = new Map(); // `${cookie}::${leagueId}` -> { at, names }

function getFresh(cache, key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < config.mflStaticTtlMs) return hit.value;
  return null;
}
function setEntry(cache, key, value) {
  cache.set(key, { at: Date.now(), value });
  // Opportunistically prune expired entries so the map can't grow unbounded across
  // many sessions.
  if (cache.size > 64) {
    const cutoff = Date.now() - config.mflStaticTtlMs;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }
}

async function listLeagues(cookie) {
  if (config.demoMode) return demo.leagues();

  const cached = getFresh(leaguesCache, cookie);
  if (cached) return cached;

  const res = await mfl.exportRequest('myleagues', { cookie, FRANCHISE_NAMES: 1 });
  const leagues = mfl.toArray(res && res.leagues && res.leagues.league).map(normalize);
  setEntry(leaguesCache, cookie, leagues);
  return leagues;
}

// Map of franchiseId -> team name for a league (from the league export). Cached on
// the static TTL (league membership/names don't move mid-session), so calling it
// per screen — and inside per-league loops — is cheap. Used to turn opponent
// franchise ids into real team names on the scoreboard/dashboard/matchup/trades.
async function franchiseNames(cookie, league) {
  if (config.demoMode) return new Map();

  const key = `${cookie}::${league.leagueId}`;
  const cached = getFresh(namesCache, key);
  if (cached) return cached;

  try {
    const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
    const fr = mfl.toArray(res && res.league && res.league.franchises && res.league.franchises.franchise);
    const names = new Map(fr.map((f) => [String(f.id), f.name || `Team ${f.id}`]));
    setEntry(namesCache, key, names);
    return names;
  } catch (e) {
    return new Map();
  }
}

// Annotate leagues with the owner's pinned/muted flags and sort pinned-first (stable
// within each group). Pure over a leagues array + token.
function applyPrefs(leagues, token) {
  const { pinned, muted } = leaguePrefs.get(token);
  const pin = new Set(pinned);
  const mut = new Set(muted);
  return leagues
    .map((l, i) => ({ l: { ...l, pinned: pin.has(String(l.leagueId)), muted: mut.has(String(l.leagueId)) }, i }))
    .sort((a, b) => (b.l.pinned ? 1 : 0) - (a.l.pinned ? 1 : 0) || a.i - b.i)
    .map((x) => x.l);
}

// The account's leagues, pinned-first and pref-annotated. `hideMuted` drops muted leagues
// for the aggregates that should skip them (Home triage, On Deck, exposure).
async function orderedLeagues(cookie, token, { hideMuted = false } = {}) {
  const all = applyPrefs(await listLeagues(cookie), token);
  return hideMuted ? all.filter((l) => !l.muted) : all;
}

module.exports = { listLeagues, normalize, franchiseNames, applyPrefs, orderedLeagues };
