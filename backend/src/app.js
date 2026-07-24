'use strict';

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

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
const pushRoutes = require('./routes/push');

const app = express();

// Behind Render's proxy: trust one hop so req.ip resolves to the real client (from
// X-Forwarded-For) rather than the edge address — the per-IP login throttle depends
// on it. Tune via a different hop count if the deployment adds proxies.
app.set('trust proxy', 1);

app.use(cors()); // mobile app is a separate origin
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, season: config.season, demoMode: config.demoMode });
});

app.use('/api/auth', authRoutes);
app.use('/api', commandRoutes);
app.use('/api', playerHubRoutes);
app.use('/api', watchlistRoutes);
app.use('/api', waiverRoutes);
app.use('/api', tradeRoutes);
app.use('/api', tradeBaitRoutes);
app.use('/api', draftRoutes);
app.use('/api', trophyRoutes);
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
