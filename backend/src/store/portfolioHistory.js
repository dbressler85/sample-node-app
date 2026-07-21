'use strict';

// Per-account daily snapshots of total dynasty portfolio value, so the app can draw a
// value-over-time sparkline (the "is my portfolio up or down" line). One point per calendar
// day (UTC): recomputing the dashboard several times a day just updates that day's point, so
// the series is one-per-day regardless of how often the screen is opened. Durable via persist.

const persist = require('./persist');

const db = () => persist.ns('portfolioHistory'); // account -> [{ date:'YYYY-MM-DD', value }]
const MAX_POINTS = 180;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Record today's total value for an account. Idempotent within a day (updates that day's
// point if the value moved). Returns the account's series.
function record(account, value, date = new Date()) {
  if (!account || typeof value !== 'number' || !(value >= 0)) return [];
  const d = db();
  const key = dayKey(date);
  const list = d[account] || (d[account] = []);
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

function history(account) {
  const d = db();
  return d[account] ? [...d[account]] : [];
}

// Replace an account's series wholesale — used to seed a synthetic demo history so the
// sparkline has something to draw before real days accumulate.
function seed(account, points) {
  const d = db();
  d[account] = points.slice(-MAX_POINTS);
  persist.touch();
  return [...d[account]];
}

module.exports = { record, history, seed, dayKey };
