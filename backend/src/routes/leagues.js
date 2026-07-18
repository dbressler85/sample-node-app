'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const leaguesService = require('../services/leagues');
const dashboardService = require('../services/dashboard');
const rosterService = require('../services/roster');

const router = express.Router();
router.use(requireSession);

// GET /api/dashboard — one card per league (matchup, score, record, standing).
router.get('/dashboard', async (req, res, next) => {
  try {
    res.json(await dashboardService.getDashboard(req.mflCookie));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues — flat list of all the account's leagues.
router.get('/leagues', async (req, res, next) => {
  try {
    res.json({ leagues: await leaguesService.listLeagues(req.mflCookie) });
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/roster — my roster in one league, names resolved.
router.get('/leagues/:leagueId/roster', async (req, res, next) => {
  try {
    res.json(await rosterService.getRoster(req.mflCookie, req.params.leagueId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
