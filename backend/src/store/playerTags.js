'use strict';

// Per-owner personal player tags: TARGET (value +10%) or AVOID (−10%) — a conviction
// overlay the value-based surfaces (trades, waivers, draft) lean on, kept SEPARATE from
// the objective market value so fairness and the partner's perception stay honest.
// Token-keyed and global across leagues (conviction is player-level, not per-league),
// durable via store/persist. Mirrors watchlist / tradebait / leaguePrefs.

const persist = require('./persist');

const db = () => persist.ns('playerTags'); // token -> { [playerId]: 'target' | 'avoid' }

// The multiplicative value modifiers. Stored as numbers so a future stronger tier
// (e.g. 'cornerstone' 1.25) is config, not a rewrite.
const MODIFIER = { target: 1.1, avoid: 0.9 };
const VALID = Object.keys(MODIFIER);

function all(token) {
  return { ...(db()[token] || {}) };
}

function get(token, playerId) {
  return (db()[token] || {})[String(playerId)] || null;
}

// Set the tag, or clear it when `tag` is falsy / unknown. Returns the resulting tag.
function set(token, playerId, tag) {
  const d = db();
  if (!d[token]) d[token] = {};
  const id = String(playerId);
  if (tag && MODIFIER[tag]) d[token][id] = tag;
  else delete d[token][id];
  persist.touch();
  return d[token][id] || null;
}

// Value modifier for a tag (1 when untagged / unknown).
function modifier(tag) {
  return MODIFIER[tag] || 1;
}

module.exports = { all, get, set, modifier, VALID };
