'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const trophies = require('../services/trophies');

const router = express.Router();
router.use(requireSession);

// GET /api/trophies — the owner's trophy case (championships across leagues/seasons).
router.get('/trophies', (req, res, next) => {
  try {
    res.json(trophies.list(req.account));
  } catch (err) {
    next(err);
  }
});

// POST /api/trophies — add a championship { leagueName, team, year, leagueId? }.
router.post('/trophies', (req, res, next) => {
  try {
    res.json(trophies.add(req.account, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/trophies/:id — remove a trophy.
router.delete('/trophies/:id', (req, res, next) => {
  try {
    res.json(trophies.remove(req.account, req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
