'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const requireSession = require('../middleware/auth');
const bugReport = require('../services/bugReport');

const router = express.Router();
router.use(requireSession);

// A tight per-endpoint cap ON TOP of the global limiter: a human files a bug now and then, so a handful
// per 10 min per IP is plenty, and it stops a misbehaving/hostile client from spamming the developer's
// inbox (or, pre-transport, flooding the persist store).
const bugReportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many bug reports — give it a few minutes.' },
});

// POST /api/bug-report — beta bug report { message, diagnostics }. Emails/relays it to the developer's
// private inbox (address held server-side only); falls back to a durable store if no transport is set.
// The response never reveals where it went — just { ok, delivered }.
router.post('/bug-report', bugReportLimiter, async (req, res, next) => {
  try {
    res.json(await bugReport.submit(req.account, req.account, req.body || {}));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
