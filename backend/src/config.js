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

  // Outbound MFL requests run with bounded concurrency plus a small stagger between
  // starts (polite, avoids bursts) — NOT strict serialization. Cold first-load fans
  // out many per-league reads; serializing them at a big gap was the dominant
  // latency. The 429/503 backoff handles it if MFL pushes back; dial these down via
  // env if you see rate limiting.
  mflMaxConcurrent: int(process.env.MFL_MAX_CONCURRENT, 4),
  // Minimum milliseconds between the START of one outbound MFL request and the next.
  mflMinRequestIntervalMs: int(process.env.MFL_MIN_REQUEST_INTERVAL_MS, 150),

  // Cache for moderately volatile MFL export responses (rosters, free agents),
  // so the many services that build one screen don't re-fetch the same data and
  // revisiting a screen doesn't re-fan-out every league. Keyed by URL + session.
  // In-app writes invalidate the affected league's reads immediately, so this can
  // be generous without showing stale data after an action; dynasty rosters/pools
  // otherwise change on the order of hours, not seconds.
  mflCacheTtlMs: int(process.env.MFL_CACHE_TTL_MS, 5 * 60 * 1000),

  // Cache for slow-changing per-league scoring reads (weekly projected scores,
  // past-week player scores). Projections move at most weekly and completed weeks
  // never change, yet a player profile fans these across all your leagues — so a
  // longer TTL keeps profiles fast after warm-up and slashes the burst that trips
  // MFL's rate limiter. Live in-week scoring uses mflLiveTtlMs instead.
  mflSlowTtlMs: int(process.env.MFL_SLOW_TTL_MS, 30 * 60 * 1000),

  // Very short cache for reads that back live-polled screens (live scoring, live
  // draft board). These are polled every 15–45s and must reflect changes on that
  // cadence, so a 60s cache would under-refresh them; keep just enough to coalesce
  // concurrent reads of the same data without lagging behind the poll.
  mflLiveTtlMs: int(process.env.MFL_LIVE_TTL_MS, 12 * 1000),

  // A short freshness ceiling for reads that a caller wants near-live even though
  // the data normally lives in a long-TTL bucket — e.g. the waiver FAAB balance,
  // which is carved out of the 1h `league` export but changes when waivers process
  // overnight. Passed as `maxAge` to exportRequest to force a refetch past this age.
  mflFreshTtlMs: int(process.env.MFL_FRESH_TTL_MS, 60 * 1000),

  // Longer cache for slow-changing data (league rules & lineup requirements,
  // league membership, the player database). These rarely change mid-season, so
  // caching them for an hour drastically cuts calls across many leagues.
  mflStaticTtlMs: int(process.env.MFL_STATIC_TTL_MS, 60 * 60 * 1000),

  // On HTTP 429/503, retry this many times with backoff (respecting Retry-After).
  mflMaxRetries: int(process.env.MFL_MAX_RETRIES, 4),

  // Per-IP failed-login throttle for /api/auth/login (credentials pass straight to
  // MFL, so this stops the backend being an open brute-force proxy). Lock a source
  // IP after this many FAILED attempts within the window; a success clears it.
  loginMaxFails: int(process.env.LOGIN_MAX_FAILS, 10),
  loginFailWindowMs: int(process.env.LOGIN_FAIL_WINDOW_MS, 15 * 60 * 1000),

  // How long to cache the (large) global player database before refetching.
  playersCacheTtlMs: int(process.env.MFL_PLAYERS_TTL_MS, 24 * 60 * 60 * 1000),

  // Persist the (large) player database to the durable store so a restart reloads it
  // from disk instead of re-downloading the whole NFL universe from MFL. Defaults on
  // only when a real DATA_DIR (mounted disk) is configured — so it's on in production
  // and off for local/test runs (which share the default data dir).
  persistPlayers: bool(process.env.MFL_PERSIST_PLAYERS, !!process.env.DATA_DIR),

  // Host used for account-level, non-league requests (login, myleagues, players).
  apiHost: process.env.MFL_API_HOST || 'api.myfantasyleague.com',

  // Durable state file for app data (waiver/trade/draft/lineup/drop stores) so it
  // survives restarts. Point DATA_DIR at a mounted disk in production. If writes
  // fail (e.g. a read-only filesystem) the app degrades to in-memory, never crashes.
  dataDir: process.env.DATA_DIR || require('path').join(__dirname, '..', 'data'),

  // Sessions hold the live MFL cookie, so they are only persisted (encrypted at
  // rest, AES-256-GCM) when an operator supplies a secret. Without it, sessions
  // stay in memory (the prior behavior) — safe, but lost on restart.
  sessionSecret: process.env.SESSION_SECRET || null,
};

module.exports = config;
