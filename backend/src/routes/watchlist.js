'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const watchlist = require('../services/watchlist');

const router = express.Router();
router.use(requireSession);

// GET /api/watchlist — starred players with their cross-league standing.
router.get('/watchlist', async (req, res, next) => {
  try {
    res.json(await watchlist.getWatchlist(req.mflCookie, req.token));
  } catch (err) {
    next(err);
  }
});

// POST /api/watchlist/:id — star a player.
router.post('/watchlist/:id', (req, res, next) => {
  try {
    res.json(watchlist.add(req.token, req.params.id));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/watchlist/:id — unstar a player.
router.delete('/watchlist/:id', (req, res, next) => {
  try {
    res.json(watchlist.remove(req.token, req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
