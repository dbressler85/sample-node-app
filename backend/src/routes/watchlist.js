'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const watchlist = require('../services/watchlist');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/watchlist — starred players with their cross-league standing.
router.get('/watchlist', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Watchlist, await watchlist.getWatchlist(req.mflCookie, req.account), 'GET /watchlist'));
  } catch (err) {
    next(err);
  }
});

// GET /api/watchlist/alerts — watched players who just became actionable (a free agent
// you could claim, or on another owner's trade bait) in one of your leagues.
router.get('/watchlist/alerts', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.WatchlistAlerts, await watchlist.alerts(req.mflCookie, req.account), 'GET /watchlist/alerts'));
  } catch (err) {
    next(err);
  }
});

// POST /api/watchlist/:id — star a player.
router.post('/watchlist/:id', (req, res, next) => {
  try {
    res.json(watchlist.add(req.account, req.params.id));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/watchlist/:id — unstar a player.
router.delete('/watchlist/:id', (req, res, next) => {
  try {
    res.json(watchlist.remove(req.account, req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
