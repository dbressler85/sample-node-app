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

const app = express();

app.use(cors()); // mobile app is a separate origin
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, season: config.season, demoMode: config.demoMode });
});

app.use('/api/auth', authRoutes);
app.use('/api', commandRoutes);
app.use('/api', playerHubRoutes);
app.use('/api', waiverRoutes);
app.use('/api', lineupRoutes);
app.use('/api', apiRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler — maps MFL/auth errors to sensible status codes.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.mflError ? 502 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Internal error' });
});

module.exports = app;
