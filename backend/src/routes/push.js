'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const notifications = require('../services/notifications');

const router = express.Router();
router.use(requireSession);

// POST /api/push/register — associate this session with an Expo push token.
// Body: { expoPushToken, prefs?: { draftClock, tradeOffer } }
router.post('/push/register', async (req, res, next) => {
  try {
    res.json(notifications.registerToken(req.token, req.body && req.body.expoPushToken, req.body && req.body.prefs));
  } catch (err) {
    next(err);
  }
});

// POST /api/push/unregister — stop notifications for this session's device.
router.post('/push/unregister', async (req, res, next) => {
  try {
    res.json(notifications.unregister(req.token));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
