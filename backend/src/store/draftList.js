'use strict';

// Per-owner, per-league "My Draft List" — the owner's ranked shortlist for an upcoming/running
// draft. MFL's `myDraftList` import owns the authoritative list on their side (and auto-picks the
// top available from it when your clock fires); we keep a local mirror keyed by the owner's token
// so the editor paints instantly and the order survives even if MFL's export shape drifts. Ordered
// array of player-id strings (rank = array index). Mirrors playerTags / watchlist / tradeDeadlines.

const persist = require('./persist');

const db = () => persist.ns('draftList'); // token -> { [leagueId]: [playerId, ...] }

function get(token, leagueId) {
  const list = (db()[token] || {})[String(leagueId)];
  return Array.isArray(list) ? [...list] : null; // null = "never set" (distinct from an empty list)
}

// Replace the whole ordered list for a league. `ids` is deduped, stringified, and empties are
// dropped. Returns the stored array.
function set(token, leagueId, ids) {
  const d = db();
  if (!d[token]) d[token] = {};
  const clean = [...new Set((ids || []).map((x) => String(x)).filter(Boolean))];
  d[token][String(leagueId)] = clean;
  persist.touch();
  return [...clean];
}

module.exports = { get, set };
