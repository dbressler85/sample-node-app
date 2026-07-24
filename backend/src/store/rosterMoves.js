'use strict';

// DEMO-ONLY overlay of roster-status moves, so IR / taxi actions taken in demo mode are reflected
// on the roster (live mode writes straight to MFL via the `ir` / `taxi_squad` imports and re-reads,
// so it needs no overlay). Keyed by leagueId (demo is single-account). A player maps to its new
// bucket: 'active' | 'ir' | 'taxi' | 'dropped'. Mirrors the other durable stores.

const persist = require('./persist');

const db = () => persist.ns('rosterMoves'); // leagueId -> { [playerId]: 'active'|'ir'|'taxi'|'dropped' }

function all(leagueId) {
  return { ...(db()[String(leagueId)] || {}) };
}

function set(leagueId, playerId, status) {
  const d = db();
  const id = String(leagueId);
  if (!d[id]) d[id] = {};
  d[id][String(playerId)] = status;
  persist.touch();
}

// Re-bucket a base { starters, bench, ir, taxi } (arrays of player-id strings) by the stored moves:
// pull each moved id out of every bucket, then drop it or place it in active(bench)/ir/taxi.
function apply(leagueId, base) {
  const moves = all(leagueId);
  if (!Object.keys(moves).length) return base;
  const out = { starters: [...(base.starters || [])], bench: [...(base.bench || [])], ir: [...(base.ir || [])], taxi: [...(base.taxi || [])] };
  for (const [id, status] of Object.entries(moves)) {
    for (const k of ['starters', 'bench', 'ir', 'taxi']) out[k] = out[k].filter((x) => String(x) !== String(id));
    if (status === 'dropped') continue;
    if (status === 'ir') out.ir.push(id);
    else if (status === 'taxi') out.taxi.push(id);
    else out.bench.push(id); // 'active' → bench (MFL activates onto the active roster)
  }
  return out;
}

module.exports = { all, set, apply };
