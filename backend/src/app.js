'use strict';

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/leagues');
const lineupRoutes = require('./routes/lineups');
const commandRoutes = require('./routes/command');
const waiverRoutes = require('./routes/waivers');
const playerHubRoutes = require('./routes/playerhub');
const watchlistRoutes = require('./routes/watchlist');
const tradeRoutes = require('./routes/trades');
const tradeBaitRoutes = require('./routes/tradebait');
const draftRoutes = require('./routes/draft');
const trophyRoutes = require('./routes/trophies');
const bugReportRoutes = require('./routes/bugReport');
const pushRoutes = require('./routes/push');
const metricsRoutes = require('./routes/metrics');

const app = express();

// Behind Render's proxy: trust one hop so req.ip resolves to the real client (from
// X-Forwarded-For) rather than the edge address — the per-IP login throttle depends
// on it. Tune via a different hop count if the deployment adds proxies.
app.set('trust proxy', 1);

// Security headers. crossOriginResourcePolicy is relaxed to 'cross-origin' because this is a JSON API
// consumed by a separate-origin mobile client; CSP is left off (there's no HTML/browser surface to
// protect, and the defaults would only add weight). Everything else (HSTS, nosniff, frameguard, …) is
// the safe default.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use(cors()); // mobile app is a separate origin
app.use(express.json());
app.use(morgan('dev'));

// Liveness/health probes must never be rate-limited or need a body — declare BEFORE the limiter.
// Answer BOTH `/api/health` and the bare root `/`: Render's deploy health check (and generic uptime
// pingers) probe `/` by default, and a 404 there reads as an unhealthy service and TIMES OUT THE
// DEPLOY (observed: "HEAD / 404" → "Timed Out"). A GET handler also serves HEAD, so both pass.
const health = (req, res) => res.json({ ok: true, season: config.season, demoMode: config.demoMode });
app.get('/', health);
app.get('/api/health', health);

// Per-IP API rate limit — an abuse backstop with a GENEROUS ceiling (a dynasty power user's cold-open
// fans a burst of per-league reads across 15–20 leagues; that must never trip it). Keyed on req.ip,
// which is the real client thanks to `trust proxy` above. Applied to everything under /api except the
// health probe declared above.
const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true, // RateLimit-* headers so a client can see its budget
  legacyHeaders: false,
  message: { error: 'Too many requests — give it a moment and try again.' },
});
app.use('/api', apiLimiter);

app.use('/api', metricsRoutes); // operational metrics (own token gate; no session middleware)
app.use('/api/auth', authRoutes);
app.use('/api', commandRoutes);
app.use('/api', playerHubRoutes);
app.use('/api', watchlistRoutes);
app.use('/api', waiverRoutes);
app.use('/api', tradeRoutes);
app.use('/api', tradeBaitRoutes);
app.use('/api', draftRoutes);
app.use('/api', trophyRoutes);
app.use('/api', bugReportRoutes);
app.use('/api', pushRoutes);
app.use('/api', lineupRoutes);
app.use('/api', apiRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler — maps MFL/auth errors to sensible status codes.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.mflError ? 502 : 500);
  if (status >= 500) console.error(err);
  const payload = { error: err.message || 'Internal error' };
  if (err.detail) payload.detail = err.detail; // e.g. MFL's raw login reply
  res.status(status).json(payload);
});

module.exports = app;
