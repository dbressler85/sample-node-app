'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const bugReport = require('../services/bugReport');

const router = express.Router();
router.use(requireSession);

// POST /api/bug-report — beta bug report { message, diagnostics }. Emails/relays it to the developer's
// private inbox (address held server-side only); falls back to a durable store if no transport is set.
// The response never reveals where it went — just { ok, delivered }.
router.post('/bug-report', async (req, res, next) => {
  try {
    res.json(await bugReport.submit(req.account, req.account, req.body || {}));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
