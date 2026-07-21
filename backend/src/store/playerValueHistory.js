'use strict';

// Per-account, per-player daily snapshots of a holding's aggregate value (summed across the
// leagues you roster him in), so the Portfolio can show which of YOUR players have risen or
// fallen the most. One point per calendar day per player. Durable via persist.

const persist = require('./persist');

const db = () => persist.ns('playerValueHistory'); // account -> { playerId -> [{ date, value }] }
const MAX_POINTS = 60;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
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
