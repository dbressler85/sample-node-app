'use strict';

// Per-owner, per-league DRAFT pick-clock OVERRIDE. The clock is normally auto-detected from MFL's
// `league` export (draftLimitHours + draftTimerSusp; see lib/leagueformat.draftClockConfig) with no
// owner input. This manual store is only a fallback/override for a league whose export somehow lacks
// those fields — when set, draft.getLeague prefers it over the auto-detected value. Token-keyed,
// durable via store/persist. Mirrors tradeDeadlines / playerTags / watchlist.

const persist = require('./persist');

const db = () => persist.ns('draftClocks'); // token -> { [leagueId]: { pickHours, pauseStart, pauseEnd } }

function all(token) {
  return { ...(db()[token] || {}) };
}

// Normalized config for the engine: { pickHours, pause: {start,end}|null } or null when unset.
function get(token, leagueId) {
  const c = (db()[token] || {})[String(leagueId)];
  if (!c || !(c.pickHours > 0)) return null;
  const hasPause = c.pauseStart != null && c.pauseEnd != null && c.pauseStart !== c.pauseEnd;
  return { pickHours: c.pickHours, pause: hasPause ? { start: c.pauseStart, end: c.pauseEnd } : null };
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const hourOk = (h) => h != null && h >= 0 && h < 24;

// Set the clock. `cfg` = { pickHours, pauseStart?, pauseEnd? } (ET hours 0–23). Falsy / invalid
// pickHours clears it. Pause is optional (omit both to mean "no overnight pause"). Returns the stored
// normalized config (or null when cleared).
function set(token, leagueId, cfg) {
  const d = db();
  if (!d[token]) d[token] = {};
  const id = String(leagueId);
  const pickHours = num(cfg && cfg.pickHours);
  if (!(pickHours > 0) || pickHours > 168) { delete d[token][id]; persist.touch(); return null; }
  const ps = num(cfg && cfg.pauseStart);
  const pe = num(cfg && cfg.pauseEnd);
  const rec = { pickHours };
  if (hourOk(ps) && hourOk(pe)) { rec.pauseStart = ps; rec.pauseEnd = pe; }
  d[token][id] = rec;
  persist.touch();
  return get(token, leagueId);
}

module.exports = { all, get, set };
