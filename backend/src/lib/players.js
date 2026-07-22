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

// Rehydrate the player map from the durable store (production, DATA_DIR set), so a
// restart skips the big MFL download. Returns a { at, byId } cache or null if absent,
// stale, or persistence is off.
function fromDisk() {
  if (!config.persistPlayers) return null;
  const d = persist.ns(PERSIST_NS);
  if (!d || !d.at || !d.byId || Date.now() - d.at >= config.playersCacheTtlMs) return null;
  const byId = new Map();
  for (const [id, p] of Object.entries(d.byId)) {
    byId.set(id, { id, name: p.name, position: p.position, team: p.team, draftYear: p.draftYear || null, draftRound: p.draftRound || null, draftPick: p.draftPick || null });
  }
  return byId.size ? { at: d.at, byId } : null;
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

async function build(cookie) {
  let players;
  if (config.demoMode) {
    players = demo.players();
  } else {
    const res = await mfl.exportRequest('players', { cookie, DETAILS: 1 });
    players = mfl.toArray(res && res.players && res.players.player);
  }
  const byId = new Map();
  for (const p of players) {
    const id = String(p.id);
    // draft_year is MFL's rookie signal (the NFL draft class). Demo carries it via the
    // fixture. Live it's on the DETAILS=1 players export. Null when unknown (e.g. UDFAs).
    // draft_round / draft_pick ride the same DETAILS=1 export as draft_year (best-effort — MFL
    // blocks their API docs from us, so verify these two field names against a real account).
    const draft = config.demoMode ? demo.draftInfo(id) : null;
    const draftYear = config.demoMode ? (draft && draft.year) || demo.draftYear(id) : (Number(p.draft_year) || null);
    const draftRound = config.demoMode ? (draft && draft.round) || null : (Number(p.draft_round) || null);
    const draftPick = config.demoMode ? (draft && draft.pick) || null : (Number(p.draft_pick) || null);
    byId.set(id, {
      id,
      name: p.name || 'Unknown',
      position: normalizePosition(p.position),
      team: p.team || 'FA',
      draftYear,
      draftRound,
      draftPick,
    });
  }
  cache = { at: Date.now(), byId };
  toDisk(cache.at, byId); // no-op in demo/test; persists in production
  return byId;
}

async function load(cookie) {
  const fresh = cache.byId.size > 0 && Date.now() - cache.at < config.playersCacheTtlMs;
  if (fresh) return cache.byId;

  // Restart recovery: hydrate from the durable store before hitting MFL.
  const disk = fromDisk();
  if (disk) {
    cache = disk;
    return cache.byId;
  }

  // Coalesce concurrent cold loads so a restart doesn't fire many identical fetches.
  if (!inflight) inflight = build(cookie).finally(() => { inflight = null; });
  return inflight;
}

// Resolve a single id against the loaded cache, with a graceful fallback.
function resolve(byId, id) {
  return (
    byId.get(String(id)) || { id: String(id), name: `Player ${id}`, position: '', team: '' }
  );
}

module.exports = { load, resolve, normalizePosition };
