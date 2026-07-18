'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const lineups = require('../services/lineups');

const router = express.Router();
router.use(requireSession);

// GET /api/lineups — cross-league overview with the points gap per league.
router.get('/lineups', async (req, res, next) => {
  try {
    res.json(await lineups.getOverview(req.mflCookie, req.token));
  } catch (err) {
    next(err);
  }
});

// POST /api/lineups/apply — set all lineups at once.
// Body (optional): { leagues: [{ leagueId, starters?: [ids] }] }
// With no body, every non-optimal league is set to its optimal lineup.
router.post('/lineups/apply', async (req, res, next) => {
  try {
    res.json(await lineups.applyAll(req.mflCookie, req.token, (req.body && req.body.leagues) || null));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/lineup — detailed slots (current + optimal) for editing.
router.get('/leagues/:leagueId/lineup', async (req, res, next) => {
  try {
    res.json(await lineups.getLineup(req.mflCookie, req.token, req.params.leagueId));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/lineup — set one league's lineup.
// Body (optional): { starters: [ids] }. With no starters, applies the optimal.
router.post('/leagues/:leagueId/lineup', async (req, res, next) => {
  try {
    const starters = (req.body && req.body.starters) || null;
    res.json(await lineups.applyLineup(req.mflCookie, req.token, req.params.leagueId, starters));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
