'use strict';

// Per-account, PER-LEAGUE daily snapshots of a team's dynasty value, so Portfolio's Teams view can
// draw each team's value-over-time sparkline and 7-day trend. One point per calendar day (UTC) per
// league — recomputing the dashboard several times a day just updates that day's point. Durable via
// persist (auto-encrypted at rest, like the other personal stores). Mirrors portfolioHistory, but
// keyed by league within the account.

const persist = require('./persist');

const db = () => persist.ns('leagueValueHistory'); // account -> { leagueId -> [{ date:'YYYY-MM-DD', value }] }
const MAX_POINTS = 120;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Record today's value for one team. Idempotent within a day. Returns that team's series.
function record(account, leagueId, value, date = new Date()) {
  if (!account || leagueId == null || typeof value !== 'number' || !(value >= 0)) return [];
  const d = db();
  const acct = d[account] || (d[account] = {});
  const lid = String(leagueId);
  const key = dayKey(date);
  const list = acct[lid] || (acct[lid] = []);
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

function series(account, leagueId) {
  const d = db();
  const acct = d[account];
  const lid = String(leagueId);
  return acct && acct[lid] ? [...acct[lid]] : [];
}

// Replace one team's series wholesale — used to seed a synthetic demo history so the sparkline has
// something to draw before real days accumulate.
function seed(account, leagueId, points) {
  const d = db();
  const acct = d[account] || (d[account] = {});
  acct[String(leagueId)] = points.slice(-MAX_POINTS);
  persist.touch();
  return [...acct[String(leagueId)]];
}

module.exports = { record, series, seed, dayKey };
