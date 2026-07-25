'use strict';

// GET /api/_metrics — an operational view of the MFL data layer, so the caching / throttle / warm
// work is measurable: call volume, cache hit-rate (and how much of it is cross-user sharing),
// rate-limit state, and the Sunday warm loop's last run. Exposes NO user data, but it's operational,
// so it's gated by METRICS_TOKEN (see config). Read-only; safe to poll.

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const mfl = require('../lib/mfl');
const metrics = require('../lib/metrics');
const warm = require('../services/warm');
const sessions = require('../store/sessions');

const router = express.Router();

// Constant-time token compare (length guard first — timingSafeEqual throws on unequal lengths).
function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Gate: with a token set, require it via the `x-metrics-token` HEADER only — NOT a query param, which
// would land in request-URL logs (morgan) and proxy access logs. Without a token, allow in
// non-production only and 404 in production (so a forgotten token can't silently expose the endpoint).
function gate(req, res) {
  if (config.metricsToken) {
    if (!tokenMatches(req.get('x-metrics-token'), config.metricsToken)) {
      res.status(401).json({ error: 'metrics token required (send the x-metrics-token header)' });
      return false;
    }
    return true;
  }
  if (process.env.NODE_ENV === 'production') { res.status(404).json({ error: 'not found' }); return false; }
  return true;
}

router.get('/_metrics', (req, res) => {
  if (!gate(req, res)) return;
  const mem = process.memoryUsage();
  res.json({
    at: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    activeSessions: sessions.active().length,
    // The headline: MFL call volume + how many reads were served from cache (and how much of that
    // was cross-user sharing). A high hitRatePct with a healthy sharedHitPct is the caching working.
    mfl: metrics.snapshot(),
    throttle: mfl.throttleStats(),
    warm: warm.stats(),
  });
});

module.exports = router;
