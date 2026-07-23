'use strict';

// Player database cache + id -> details resolution.
//
// MFL rosters reference players only by numeric id. The name/team/position lookup
// lives in one big global `players` export that we fetch once and cache, because
// it's large and MFL asks clients not to pull it repeatedly.

const mfl = require('./mfl');
const config = require('../config');
const demo = require('../demo/fixtures');
const persist = require('../store/persist');

// MFL spells positions a few ways across exports (team defense is "Def", kickers
// sometimes "K"). Normalize to the canonical codes the rest of the app uses so
// slot eligibility, position colors, and volatility bands all line up.
function normalizePosition(pos) {
  const p = String(pos || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (p === 'DEF' || p === 'DST' || p === 'TMDEF' || p === 'DEFENSE') return 'DEF';
  if (p === 'PK' || p === 'K') return 'PK';
  return p; // cleaned/uppercased, so "WR " matches "WR" in slot eligibility
}

let cache = { at: 0, byId: new Map() };
let inflight = null; // coalesce concurrent cold loads into one fetch

const PERSIST_NS = 'playersDb'; // { at, byId: { id: { name, position, team } } }

// Read the persisted player map regardless of age. Returns { at, byId } or null when
// persistence is off / the store is absent or empty. Used two ways: fromDisk() gates this
// by TTL for the fast-path skip in load(); refresh() uses the any-age snapshot as the base
// to delta from (a stale disk snapshot is still a valid base for a SINCE fetch).
function readDisk() {
  if (!config.persistPlayers) return null;
  const d = persist.ns(PERSIST_NS);
  if (!d || !d.at || !d.byId) return null;
  const byId = new Map();
  for (const [id, p] of Object.entries(d.byId)) {
    byId.set(id, { id, name: p.name, position: p.position, team: p.team, draftYear: p.draftYear || null, draftRound: p.draftRound || null, draftPick: p.draftPick || null });
  }
  return byId.size ? { at: d.at, byId } : null;
}

// TTL-bounded disk snapshot: only returned while still fresh, so load() can skip any MFL
// fetch on a restart within the cache window.
function fromDisk() {
  const d = readDisk();
  if (!d || Date.now() - d.at >= config.playersCacheTtlMs) return null;
  return d;
}

function toDisk(at, byId) {
  if (!config.persistPlayers) return;
  const obj = {};
  for (const [id, p] of byId) obj[id] = { name: p.name, position: p.position, team: p.team, draftYear: p.draftYear || null, draftRound: p.draftRound || null, draftPick: p.draftPick || null };
  const d = persist.ns(PERSIST_NS);
  d.at = at;
  d.byId = obj;
  persist.touch();
}

// draft_year is MFL's rookie signal (the NFL draft class); it's on the DETAILS=1 players
// export, along with draft_round / draft_pick. Null when unknown (e.g. UDFAs).
function mapLivePlayer(p) {
  return {
    id: String(p.id),
    name: p.name || 'Unknown',
    position: normalizePosition(p.position),
    team: p.team || 'FA',
    draftYear: Number(p.draft_year) || null,
    draftRound: Number(p.draft_round) || null,
    draftPick: Number(p.draft_pick) || null,
  };
}

function buildDemoMap() {
  const byId = new Map();
  for (const p of demo.players()) {
    const id = String(p.id);
    const draft = demo.draftInfo(id);
    byId.set(id, {
      id,
      name: p.name || 'Unknown',
      position: normalizePosition(p.position),
      team: p.team || 'FA',
      draftYear: (draft && draft.year) || demo.draftYear(id),
      draftRound: (draft && draft.round) || null,
      draftPick: (draft && draft.pick) || null,
    });
  }
  return byId;
}

// True when an MFL error means "the player DB hasn't changed since your SINCE timestamp" —
// which for a delta refresh is success, not failure. The error is `{"error":{"$t":"No Player
// Database Changes Since ..."}}` (mflError is the object) or occasionally a plain string.
function isNoChangesSince(e) {
  const raw = e && e.mflError;
  const msg = raw && typeof raw === 'object' ? String(raw.$t || '') : String(raw || (e && e.message) || '');
  return /no player database changes/i.test(msg);
}

function commit(byId) {
  cache = { at: Date.now(), byId };
  toDisk(cache.at, byId); // no-op in demo/test; persists in production
  return byId;
}

// Freshest usable prior snapshot to delta from: the in-memory map if we have one (even if
// stale — staleness only means "time to refresh", not "unusable"), else an any-age disk
// snapshot. Null when we have nothing (a truly cold process) → refresh does a full download.
function baseSnapshot() {
  if (cache.byId.size) return cache;
  return readDisk();
}

async function refresh(cookie) {
  if (config.demoMode) return commit(buildDemoMap());

  // Delta-refresh when we already have a snapshot. MFL's players export supports SINCE=<unix ts>
  // to return only players changed since then, so a daily refresh becomes a small delta instead
  // of re-downloading the whole ~2,000+ player universe. Correctness does NOT depend on MFL
  // honoring SINCE: if it returns only changes we merge them onto the base; if it ignores SINCE
  // and returns everyone we merge the full set onto the base — either way the map ends complete.
  // Only the payload size differs. (Players are added/updated, never removed from MFL's DB, so a
  // merge-only delta can't leave a stale ghost.)
  const base = baseSnapshot();
  if (base && base.byId.size) {
    const since = Math.floor(base.at / 1000);
    let changed;
    try {
      const res = await mfl.exportRequest('players', { cookie, DETAILS: 1, SINCE: since });
      changed = mfl.toArray(res && res.players && res.players.player);
    } catch (e) {
      // MFL returns an ERROR (not an empty list) when nothing changed since SINCE, e.g.
      // {"error":{"$t":"No Player Database Changes Since ..."}}. For a delta that's the happy
      // path — the base map is already current — so keep it (with a fresh timestamp). This must
      // be handled or the daily refresh throws and, unhandled, crashes the process. Anything else
      // rethrows.
      if (isNoChangesSince(e)) return commit(new Map(base.byId));
      throw e;
    }
    const merged = new Map(base.byId);
    for (const p of changed) merged.set(String(p.id), mapLivePlayer(p));
    return commit(merged);
  }

  const res = await mfl.exportRequest('players', { cookie, DETAILS: 1 });
  const byId = new Map();
  for (const p of mfl.toArray(res && res.players && res.players.player)) byId.set(String(p.id), mapLivePlayer(p));
  return commit(byId);
}

async function load(cookie) {
  const fresh = cache.byId.size > 0 && Date.now() - cache.at < config.playersCacheTtlMs;
  if (fresh) return cache.byId;

  // Restart recovery: hydrate from the durable store before hitting MFL (skips the fetch
  // entirely while the disk snapshot is still within the cache window).
  const disk = fromDisk();
  if (disk) {
    cache = disk;
    return cache.byId;
  }

  // Coalesce concurrent cold loads so a restart doesn't fire many identical fetches.
  if (!inflight) inflight = refresh(cookie).finally(() => { inflight = null; });
  return inflight;
}

// Test hooks (no-ops in normal use): reset clears the cache; ageCache backdates it so the
// next load() takes the stale-but-usable path and issues a SINCE delta.
function _resetForTest() { cache = { at: 0, byId: new Map() }; inflight = null; }
function _ageCacheForTest(atMs) { cache.at = atMs; }

// Resolve a single id against the loaded cache, with a graceful fallback.
function resolve(byId, id) {
  return (
    byId.get(String(id)) || { id: String(id), name: `Player ${id}`, position: '', team: '' }
  );
}

module.exports = { load, resolve, normalizePosition, _resetForTest, _ageCacheForTest };
