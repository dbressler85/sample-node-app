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
    res.json(notifications.registerToken(req.account, req.body && req.body.expoPushToken, req.body && req.body.prefs));
  } catch (err) {
    next(err);
  }
});

// GET /api/push/prefs — the owner's current push-channel choices (defaults if unset).
router.get('/push/prefs', (req, res, next) => {
  try {
    res.json(notifications.getPrefs(req.account));
  } catch (err) {
    next(err);
  }
});

// POST /api/push/prefs — set which push channels to receive. Body: { prefs: { channel: bool } }.
router.post('/push/prefs', (req, res, next) => {
  try {
    res.json(notifications.setPrefs(req.account, req.body && req.body.prefs));
  } catch (err) {
    next(err);
  }
});

// POST /api/push/test — send a diagnostic push to this account's registered device NOW and return
// Expo's verdict, so the app can tell the user exactly where push stands (no token registered / Expo
// rejected it / accepted). The one end-to-end check that doesn't need a real draft or trade to happen.
router.post('/push/test', async (req, res, next) => {
  try {
    res.json(await notifications.sendTest(req.account));
  } catch (err) {
    next(err);
  }
});

// POST /api/push/unregister — stop notifications for this session's device.
router.post('/push/unregister', async (req, res, next) => {
  try {
    res.json(notifications.unregister(req.account));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
