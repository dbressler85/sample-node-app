'use strict';

// Per-account, per-player daily snapshots of a holding's aggregate value (summed across the
// leagues you roster him in), so the Portfolio can show which of YOUR players have risen or
// fallen the most. One point per calendar day per player. Durable via persist.

const persist = require('./persist');

const db = () => persist.ns('playerValueHistory'); // account -> { playerId -> [{ date, value }] }
const MAX_POINTS = 60;
// Unlike the league/portfolio history stores (keyed by ~15 leagues), THIS store gains a key per player
// ever held — across a season of add/drop/waiver/trade churn that drifts toward the ~2000-player
// universe and risks the persist 5 MB latch. So GC keys whose most-recent point is older than STALE_DAYS
// (that player is no longer rostered). Only scanned once an account's map grows past GC_TRIGGER_KEYS, so
// the common small-account case pays nothing.
const STALE_DAYS = 45;
const GC_TRIGGER_KEYS = 300;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Drop series for players no longer held (last snapshot older than STALE_DAYS). ISO YYYY-MM-DD strings
// compare lexicographically, so a plain `<` against the cutoff day is a correct date comparison.
function gc(acct) {
  const keys = Object.keys(acct);
  if (keys.length <= GC_TRIGGER_KEYS) return;
  const cutoff = dayKey(new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000));
  for (const id of keys) {
    const list = acct[id];
    const last = list && list[list.length - 1];
    if (!last || last.date < cutoff) delete acct[id];
  }
}

function record(account, playerId, value, date = new Date()) {
  if (!account || playerId == null || typeof value !== 'number' || !(value >= 0)) return [];
  const d = db();
  const acct = d[account] || (d[account] = {});
  const id = String(playerId);
  const list = acct[id] || (acct[id] = []);
  const key = dayKey(date);
  const last = list[list.length - 1];
  if (last && last.date === key) {
    if (last.value !== value) { last.value = value; persist.touch(); }
  } else {
    list.push({ date: key, value });
    if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
    gc(acct); // prune no-longer-held players when this account's map has grown large
    persist.touch();
  }
  return [...list];
}

function series(account, playerId) {
  const acct = db()[account];
  const list = acct && acct[String(playerId)];
  return list ? [...list] : [];
}

// Seed a synthetic series (demo/testing) so movers have something to compute before real
// days accrue. Replaces the player's series.
function seed(account, playerId, points) {
  const d = db();
  const acct = d[account] || (d[account] = {});
  acct[String(playerId)] = points.slice(-MAX_POINTS);
  persist.touch();
  return [...acct[String(playerId)]];
}

module.exports = { record, series, seed, dayKey };
