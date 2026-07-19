'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const portfolio = require('../services/portfolio');
const scoreboard = require('../services/scoreboard');
const exposure = require('../services/exposure');

const router = express.Router();
router.use(requireSession);

// GET /api/home — portfolio roll-up + cross-league triage queue (server-side).
router.get('/home', async (req, res, next) => {
  try {
    res.json(await portfolio.getHome(req.mflCookie, req.token));
  } catch (err) {
    next(err);
  }
});

// GET /api/home/league/:leagueId — one league's triage, for progressive loading.
router.get('/home/league/:leagueId', async (req, res, next) => {
  try {
    res.json(await portfolio.getLeagueTriage(req.mflCookie, req.token, req.params.leagueId));
  } catch (err) {
    next(err);
  }
});

// GET /api/scoreboard — live matchups across leagues, sorted by closeness.
router.get('/scoreboard', async (req, res, next) => {
  try {
    res.json(await scoreboard.getScoreboard(req.mflCookie));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/exposure — every league you roster each player in.
router.get('/players/exposure', async (req, res, next) => {
  try {
    res.json(await exposure.getExposure(req.mflCookie));
  } catch (err) {
    next(err);
  }
});

// GET /api/news — league news mapped to which of your teams it affects.
router.get('/news', async (req, res, next) => {
  try {
    res.json(await exposure.getNews(req.mflCookie));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
