'use strict';

const express = require('express');
const mfl = require('../lib/mfl');
const config = require('../config');
const sessions = require('../store/sessions');
const loginGuard = require('../lib/loginGuard');

const router = express.Router();

// POST /api/auth/login  { username, password }
// Logs into MFL once, stores the resulting cookie server-side, and returns an
// opaque app token. In demo mode any credentials succeed with a fake cookie.
// Per-IP failed-attempt throttle keeps this from being an open brute-force proxy.
router.post('/login', async (req, res, next) => {
  const { username, password } = req.body || {};
  if (!config.demoMode && (!username || !password)) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const ip = req.ip; // app sets trust proxy, so this is the client IP, not Render's edge
  const gate = loginGuard.check(ip);
  if (gate.blocked) {
    res.set('Retry-After', String(gate.retryAfter));
    return res.status(429).json({ error: `Too many failed login attempts. Try again in ${gate.retryAfter}s.` });
  }

  try {
    const cookie = config.demoMode ? 'demo-cookie' : await mfl.login(username, password);
    loginGuard.succeed(ip);
    const token = sessions.create({ cookie, username: username || 'demo' });
    res.json({ token, username: username || 'demo', season: config.season, demoMode: config.demoMode });
  } catch (err) {
    loginGuard.fail(ip); // bad creds / MFL rejection — count it toward the lockout
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
