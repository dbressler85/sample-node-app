'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const leaguesService = require('../services/leagues');
const dashboardService = require('../services/dashboard');
const rosterService = require('../services/roster');
const leagueService = require('../services/league');
const leaguePrefs = require('../store/leaguePrefs');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/dashboard — one card per league (matchup, score, record, standing).
router.get('/dashboard', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Dashboard, await dashboardService.getDashboard(req.mflCookie), 'GET /dashboard'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues — all the account's leagues, pinned-first with the pinned flag.
router.get('/leagues', async (req, res, next) => {
  try {
    const payload = { leagues: await leaguesService.orderedLeagues(req.mflCookie, req.account) };
    res.json(checkResponse(schemas.Leagues, payload, 'GET /leagues'));
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
    res.json(checkResponse(schemas.Roster, await rosterService.getRoster(req.mflCookie, req.params.leagueId), 'GET /roster'));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/ir — move players to/from Injured Reserve.
// Body: { activate?: [ids], deactivate?: [ids], drop?: [ids] }. Returns the refreshed roster.
router.post('/leagues/:leagueId/ir', async (req, res, next) => {
  try {
    const { activate, deactivate, drop } = req.body || {};
    res.json(checkResponse(schemas.Roster, await rosterService.moveIr(req.mflCookie, req.account, req.params.leagueId, { activate, deactivate, drop }), 'POST /ir'));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/taxi — move players to/from the Taxi Squad.
// Body: { promote?: [ids], demote?: [ids], drop?: [ids] }. Returns the refreshed roster.
router.post('/leagues/:leagueId/taxi', async (req, res, next) => {
  try {
    const { promote, demote, drop } = req.body || {};
    res.json(checkResponse(schemas.Roster, await rosterService.moveTaxi(req.mflCookie, req.account, req.params.leagueId, { promote, demote, drop }), 'POST /taxi'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/standings — every franchise ranked (record, PF/PA).
router.get('/leagues/:leagueId/standings', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Standings, await leagueService.getStandings(req.mflCookie, req.params.leagueId), 'GET /standings'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/teams — every franchise's roster (opponent scouting).
router.get('/leagues/:leagueId/teams', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Teams, await leagueService.getTeams(req.mflCookie, req.params.leagueId), 'GET /leagues/:leagueId/teams'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/transactions — recent league transaction feed.
router.get('/leagues/:leagueId/transactions', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Transactions, await leagueService.getTransactions(req.mflCookie, req.params.leagueId), 'GET /leagues/:leagueId/transactions'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
