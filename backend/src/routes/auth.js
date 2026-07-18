'use strict';

const express = require('express');
const mfl = require('../lib/mfl');
const config = require('../config');
const sessions = require('../store/sessions');

const router = express.Router();

// POST /api/auth/login  { username, password }
// Logs into MFL once, stores the resulting cookie server-side, and returns an
// opaque app token. In demo mode any credentials succeed with a fake cookie.
router.post('/login', async (req, res, next) => {
  const { username, password } = req.body || {};
  if (!config.demoMode && (!username || !password)) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  try {
    const cookie = config.demoMode ? 'demo-cookie' : await mfl.login(username, password);
    const token = sessions.create({ cookie, username: username || 'demo' });
    res.json({ token, username: username || 'demo', season: config.season, demoMode: config.demoMode });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token) sessions.destroy(token);
  res.json({ ok: true });
});

module.exports = router;
