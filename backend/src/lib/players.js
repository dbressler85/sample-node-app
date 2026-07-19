'use strict';

// Player database cache + id -> details resolution.
//
// MFL rosters reference players only by numeric id. The name/team/position lookup
// lives in one big global `players` export that we fetch once and cache, because
// it's large and MFL asks clients not to pull it repeatedly.

const mfl = require('./mfl');
const config = require('../config');
const demo = require('../demo/fixtures');

// MFL spells positions a few ways across exports (team defense is "Def", kickers
// sometimes "K"). Normalize to the canonical codes the rest of the app uses so
// slot eligibility, position colors, and volatility bands all line up.
function normalizePosition(pos) {
  const p = String(pos || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (p === 'DEF' || p === 'DST' || p === 'TMDEF' || p === 'DEFENSE') return 'DEF';
  if (p === 'PK' || p === 'K') return 'PK';
  return String(pos || '').toUpperCase();
}

let cache = { at: 0, byId: new Map() };

async function load(cookie) {
  const fresh = cache.byId.size > 0 && Date.now() - cache.at < config.playersCacheTtlMs;
  if (fresh) return cache.byId;

  let players;
  if (config.demoMode) {
    players = demo.players();
  } else {
    const res = await mfl.exportRequest('players', { cookie, DETAILS: 1 });
    players = mfl.toArray(res && res.players && res.players.player);
  }

  const byId = new Map();
  for (const p of players) {
    byId.set(String(p.id), {
      id: String(p.id),
      name: p.name || 'Unknown',
      position: normalizePosition(p.position),
      team: p.team || 'FA',
    });
  }
  cache = { at: Date.now(), byId };
  return byId;
}

// Resolve a single id against the loaded cache, with a graceful fallback.
function resolve(byId, id) {
  return (
    byId.get(String(id)) || { id: String(id), name: `Player ${id}`, position: '', team: '' }
  );
}

module.exports = { load, resolve, normalizePosition };
