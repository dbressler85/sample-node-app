'use strict';

// Central configuration, driven by environment variables.
// Everything has a sane default so the server boots with zero config in DEMO mode.

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: int(process.env.PORT, 4000),

  // The fantasy football season year that league data is scoped to.
  // MFL scopes every request by year; dynasty leagues roll over each season.
  season: int(process.env.MFL_SEASON, new Date().getUTCFullYear()),

  // DEMO_MODE serves realistic fixture data instead of calling MFL. It lets the
  // mobile app (and reviewers) exercise the whole flow without a real account.
  // Defaults ON so a fresh clone works immediately; set MFL_DEMO_MODE=false for live.
  demoMode: bool(process.env.MFL_DEMO_MODE, true),

  // MFL asks API clients to identify themselves with a descriptive User-Agent and
  // to keep request volume reasonable. High-volume clients should register for an
  // API key in the MFL Developers Program and set MFL_API_KEY.
  // https://api.myfantasyleague.com/2020/api_info?STATE=details
  userAgent: process.env.MFL_USER_AGENT || 'dynasty-central/0.1 (personal multi-league manager)',
  apiKey: process.env.MFL_API_KEY || null,

  // Minimum milliseconds between outbound MFL requests (simple client-side throttle).
  mflMinRequestIntervalMs: int(process.env.MFL_MIN_REQUEST_INTERVAL_MS, 500),

  // How long to cache the (large) global player database before refetching.
  playersCacheTtlMs: int(process.env.MFL_PLAYERS_TTL_MS, 24 * 60 * 60 * 1000),

  // Host used for account-level, non-league requests (login, myleagues, players).
  apiHost: process.env.MFL_API_HOST || 'api.myfantasyleague.com',
};

module.exports = config;
