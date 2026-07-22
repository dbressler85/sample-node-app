'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const lineups = require('../services/lineups');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/lineups?mode=auto|safe|balanced|aggressive
// Cross-league overview: points gap, warnings, matchup + win prob per league.
router.get('/lineups', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Lineups, await lineups.getOverview(req.mflCookie, req.account, req.query.mode), 'GET /lineups'));
  } catch (err) {
    next(err);
  }
});

// GET /api/lineups/plan?mode=... — preview "Set All" as per-league diffs, no writes.
router.get('/lineups/plan', async (req, res, next) => {
  try {
    res.json(await lineups.plan(req.mflCookie, req.account, req.query.mode));
  } catch (err) {
    next(err);
  }
});

// POST /api/lineups/apply — set all lineups at once.
// Body (optional): { mode, leagues: [{ leagueId, starters?: [ids] }] }
router.post('/lineups/apply', async (req, res, next) => {
  try {
    const body = req.body || {};
    res.json(await lineups.applyAll(req.mflCookie, req.account, body.mode, body.leagues || null));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/lineup?mode=... — detailed slots for editing.
router.get('/leagues/:leagueId/lineup', async (req, res, next) => {
  try {
    res.json(await lineups.getLineup(req.mflCookie, req.account, req.params.leagueId, req.query.mode));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/lineup — set one league's lineup.
// Body (optional): { starters: [ids], mode }
router.post('/leagues/:leagueId/lineup', async (req, res, next) => {
  try {
    const body = req.body || {};
    res.json(await lineups.applyLineup(req.mflCookie, req.account, req.params.leagueId, body.starters || null, body.mode));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
