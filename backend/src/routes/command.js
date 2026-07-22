'use strict';

const express = require('express');
const config = require('../config');
const requireSession = require('../middleware/auth');
const portfolio = require('../services/portfolio');
const scoreboard = require('../services/scoreboard');
const exposure = require('../services/exposure');
const ondeck = require('../services/ondeck');
const leaguesService = require('../services/leagues');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/me — the signed-in manager's identity + league count, for the Profile screen.
// Kept lightweight (identity + a cached league count); the profile composes value/outlook
// from /api/portfolio and activity from /api/watchlist client-side.
router.get('/me', async (req, res, next) => {
  try {
    const leagues = await leaguesService.orderedLeagues(req.mflCookie, req.account).catch(() => []);
    res.json(checkResponse(schemas.Me, {
      username: (req.session && req.session.username) || null,
      account: req.account,
      season: config.season,
      demoMode: config.demoMode,
      leagues: leagues.length,
    }, 'GET /me'));
  } catch (err) {
    next(err);
  }
});

// GET /api/ondeck — time-sorted deadlines across leagues (draft clocks, lineup
// locks, scheduled drafts, waiver runs). The proactive "what needs me next" view.
router.get('/ondeck', async (req, res, next) => {
  try {
    res.json(await ondeck.getOnDeck(req.mflCookie, req.account));
  } catch (err) {
    next(err);
  }
});

// GET /api/home — portfolio roll-up + cross-league triage queue (server-side).
router.get('/home', async (req, res, next) => {
  try {
    res.json(await portfolio.getHome(req.mflCookie, req.account));
  } catch (err) {
    next(err);
  }
});

// GET /api/home/league/:leagueId — one league's triage, for progressive loading.
router.get('/home/league/:leagueId', async (req, res, next) => {
  try {
    res.json(await portfolio.getLeagueTriage(req.mflCookie, req.account, req.params.leagueId));
  } catch (err) {
    next(err);
  }
});

// GET /api/portfolio — dynasty value dashboard + value-at-risk across leagues.
router.get('/portfolio', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Portfolio, await portfolio.getDashboard(req.mflCookie, req.account), 'GET /portfolio'));
  } catch (err) {
    next(err);
  }
});

// POST /api/portfolio/holdings/:playerId/bait — shop (or un-shop) a holding across every
// league you roster him in. Body: { on: bool, leagueIds: [..] }.
router.post('/portfolio/holdings/:playerId/bait', async (req, res, next) => {
  try {
    const { on, leagueIds } = req.body || {};
    res.json(await portfolio.shopHolding(req.mflCookie, req.account, req.params.playerId, !!on, leagueIds));
  } catch (err) {
    next(err);
  }
});

// GET /api/scoreboard — live matchups across leagues, sorted by closeness.
router.get('/scoreboard', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Scoreboard, await scoreboard.getScoreboard(req.mflCookie), 'GET /scoreboard'));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/exposure — every league you roster each player in.
router.get('/players/exposure', async (req, res, next) => {
  try {
    res.json(await exposure.getExposure(req.mflCookie, req.account));
  } catch (err) {
    next(err);
  }
});

// GET /api/news — league news mapped to which of your teams it affects.
router.get('/news', async (req, res, next) => {
  try {
    res.json(await exposure.getNews(req.mflCookie, req.account));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
