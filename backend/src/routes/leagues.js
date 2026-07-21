'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const leaguesService = require('../services/leagues');
const dashboardService = require('../services/dashboard');
const rosterService = require('../services/roster');
const leaguePrefs = require('../store/leaguePrefs');

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

// GET /api/leagues — all the account's leagues, pinned-first with the pinned flag.
router.get('/leagues', async (req, res, next) => {
  try {
    res.json({ leagues: await leaguesService.orderedLeagues(req.mflCookie, req.account) });
  } catch (err) {
    next(err);
  }
});

// PIN a league to the top of every cross-league view. POST sets it, DELETE clears it.
router.post('/leagues/:leagueId/pin', (req, res, next) => {
  try { leaguePrefs.setPin(req.account, req.params.leagueId, true); res.json({ ok: true, pinned: true }); } catch (err) { next(err); }
});
router.delete('/leagues/:leagueId/pin', (req, res, next) => {
  try { leaguePrefs.setPin(req.account, req.params.leagueId, false); res.json({ ok: true, pinned: false }); } catch (err) { next(err); }
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
