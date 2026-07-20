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

// GET /api/push/prefs — the owner's current push-channel choices (defaults if unset).
router.get('/push/prefs', (req, res, next) => {
  try {
    res.json(notifications.getPrefs(req.token));
  } catch (err) {
    next(err);
  }
});

// POST /api/push/prefs — set which push channels to receive. Body: { prefs: { channel: bool } }.
router.post('/push/prefs', (req, res, next) => {
  try {
    res.json(notifications.setPrefs(req.token, req.body && req.body.prefs));
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
