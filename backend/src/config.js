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
  //
  // Default is environment-aware: OFF under NODE_ENV=production (a real deploy runs
  // LIVE unless someone explicitly opts into demo), ON everywhere else so a fresh
  // clone / local dev boots with zero config. This is the robust half of the demo-in-
  // prod guard below: production defaults to live even if MFL_DEMO_MODE is never set,
  // instead of defaulting to demo and getting refused at boot. An explicit
  // MFL_DEMO_MODE always wins (and MFL_DEMO_MODE=true in production still trips the
  // guard — that's the real footgun we want to catch).
  demoMode: bool(process.env.MFL_DEMO_MODE, process.env.NODE_ENV !== 'production'),

  // MFL's Developer Program authenticates a client by its registered, validated User-Agent — there
  // is NO key to paste, the UA IS the credential. Register this exact string at the API Client
  // Registration page (validated by an SMS code), set MFL_USER_AGENT to it in prod, and flip
  // MFL_CLIENT_REGISTERED=true. A validated client gets ~2.5x the per-IP rate limit. Keep the string
  // STABLE — registration is keyed to the exact UA, so a change means re-registering. The same UA
  // should ride on every request (login + export + import). See docs/MFL_CLIENT_REGISTRATION.md.
  userAgent: process.env.MFL_USER_AGENT || 'DynastyCentral/1.0',
  // Whether that UA has been registered + SMS-validated with MFL. Informational: surfaced on
  // /_metrics and logged at boot so you can confirm prod is sending the registered client string.
  mflClientRegistered: bool(process.env.MFL_CLIENT_REGISTERED, false),
  // Device-origin reads (docs/DEVICE_ORIGIN_MFL.md): when on, the backend will hand an authenticated
  // device its own MFL session cookie (GET /api/session/mfl-cookie) so the app can fetch per-user reads
  // straight from MFL (its own IP + rate budget). OFF by default — the endpoint 404s until we commit,
  // and it never exposes the cookie to anyone but the session's own authenticated owner.
  deviceReadsEnabled: bool(process.env.DEVICE_READS_ENABLED, false),
  // Legacy per-user APIKEY (export-only, per league) — unused by the registered-UA model, kept for
  // requests that opt into key auth. The UA registration above is the path to higher limits.
  apiKey: process.env.MFL_API_KEY || null,
  // Sampled device/backend parity self-check (A-6/U-6): the fraction of device-origin portfolio reads on
  // which the backend re-fetches one league and shadow-compares it against the device's data, so silent
  // divergence is observable on /_metrics. Kept low (device-origin's point is to NOT read on the backend, so
  // the check must be rare). 0 disables it.
  deviceParitySampleRate: (() => { const n = parseFloat(process.env.DEVICE_PARITY_SAMPLE_RATE); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.02; })(),

  // Outbound MFL requests run with bounded concurrency plus a small stagger between
  // starts (polite, avoids bursts) — NOT strict serialization. Cold first-load fans
  // out many per-league reads; serializing them at a big gap was the dominant latency.
  // The 429/503 backoff pulls back if MFL pushes.
  //
  // Defaults stay conservative — polite for an UNregistered client. MFL's Developer Program
  // authenticates a client by its registered, validated User-Agent (config.userAgent) — the
  // app already sends it and there is NO key to paste — and a validated client gets higher
  // rate limits. So once your client is validated, RAISE THROUGHPUT by setting these two env
  // vars, e.g. MFL_MAX_CONCURRENT=8 and MFL_MIN_REQUEST_INTERVAL_MS=75. The stagger (interval),
  // not the concurrency, caps the start RATE of a big cold fan-out, so lowering it is what
  // actually speeds cross-league loads.
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

  // Daily cache for data MFL explicitly says changes at most once a day: the player
  // DATABASE ("only changed once a day, so request it no more than once a day and keep
  // it for that long") and the NFL schedule (~fixed for the season). These sat in the
  // 1h static tier before, so we re-downloaded the whole player universe ~24× more than
  // MFL asks. A day-long TTL matches their guidance and slashes cold-start cost.
  mflDailyTtlMs: int(process.env.MFL_DAILY_TTL_MS, 24 * 60 * 60 * 1000),

  // On HTTP 503, retry this many times with backoff. NOTE: a 429 is NOT retried — MFL's
  // docs say "if a request fails, don't retry"; we cool down and surface it instead.
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

  // ADP flavor for the draft board. MFL's `adp` export defaults to 'NKR' (redraft + keeper +
  // rookie mixed). This is a DYNASTY app, so keeper + rookie ADP ('KR') is the more relevant
  // consensus for both startup and rookie drafts — redraft ADP dilutes dynasty ordering. The
  // response shape is unchanged (it's a server-side filter), so this only reshapes which drafts
  // feed the numbers. Set MFL_ADP_IS_KEEPER=NKR to restore MFL's mixed default.
  mflAdpIsKeeper: process.env.MFL_ADP_IS_KEEPER || 'KR',

  // A league's next waiver run counts as an imminent, act-now item within this window — it
  // surfaces as a Home action and a highlight on the Waivers screen. Default 3 days: tight enough
  // for the in-season cadence (where the window closes fast) and still fine in the offseason.
  waiverImminentMs: int(process.env.MFL_WAIVER_IMMINENT_MS, 3 * 24 * 60 * 60 * 1000),

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

  // --- Sunday pre-warm worker ------------------------------------------------
  // On game day, keep the lineup-relevant reads (rosters, projections, free agents, league settings,
  // schedule) for active users' leagues WARM in the shared cache during the morning→kickoff window,
  // so both the Sunday-morning lineup-checkers AND the kickoff crowd hit warm cache instead of a cold
  // fan-out. It runs at LOW priority (never delays a real user request) and re-warms on a cadence
  // matched to the roster TTL, so nothing served is more than one TTL stale (waivers process Sunday
  // morning — a 7-hour-old roster/FAAB would be wrong, so we DON'T just extend the TTL). Every read
  // it primes is a cache HIT if natural traffic already refreshed it, so it self-throttles to zero
  // work on busy leagues. On by default in production; the worker also self-gates on live (non-demo)
  // mode at startup. Force with MFL_WARM_ENABLED=true (local live testing) or false (disable).
  warmEnabled: bool(process.env.MFL_WARM_ENABLED, process.env.NODE_ENV === 'production'),
  // The game-day window, in America/New_York hours [start, end). Default 6am–2pm ET: covers the
  // morning lineup check through the 1pm kickoff. Extend the end hour to cover later slates.
  warmStartHourEt: int(process.env.MFL_WARM_START_HOUR_ET, 6),
  warmEndHourEt: int(process.env.MFL_WARM_END_HOUR_ET, 14),
  // Day-of-week to warm (0=Sun). Sunday only by default.
  warmDayEt: int(process.env.MFL_WARM_DAY_ET, 0),
  // How often to re-warm during the window. Default 5min = the roster TTL, so rosters are never more
  // than one cycle stale and a league already refreshed by real traffic is a no-op cache hit.
  warmIntervalMs: int(process.env.MFL_WARM_INTERVAL_MS, 5 * 60 * 1000),
  // How often the background GLOBAL prime runs (player DB + FantasyCalc value lenses for the common
  // league sizes + prior-season stats), so a user's request never eats a cold fetch. Every 6h — SHORTER
  // than the 12h FantasyCalc TTL, so a background pass always re-fetches when the data ages out before a
  // user hits the miss. Mostly a no-op cache hit otherwise. Independent of the Sunday game-day window.
  valuePrimeIntervalMs: int(process.env.MFL_VALUE_PRIME_INTERVAL_MS, 6 * 60 * 60 * 1000),

  // Operational metrics endpoint (GET /api/_metrics): MFL call volume, cache hit-rate, throttle
  // state, warm-loop stats. It exposes no user data, but it IS operational, so it's gated by a
  // secret. Set METRICS_TOKEN and pass it via the `x-metrics-token` header (never a query param — that
  // would leak into request-URL logs). When unset,
  // the endpoint is open in non-production (local/demo) and DISABLED (404) in production — so you
  // can't accidentally expose it by forgetting to set the token.
  metricsToken: process.env.METRICS_TOKEN || null,

  // Per-IP API rate limit — an abuse backstop, NOT a normal-use throttle. A dynasty power user opening
  // the app cold fans a burst of per-league reads across 15–20 leagues, plus polling, so the ceiling is
  // deliberately GENEROUS: only a runaway client or abuse should ever hit it. Tune via env; the window
  // is in ms. (Health checks and the default are exempt/looser — see app.js.)
  rateLimitWindowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
  rateLimitMax: int(process.env.RATE_LIMIT_MAX, 600),
};

module.exports = config;
