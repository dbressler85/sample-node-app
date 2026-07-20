'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const trades = require('../services/trades');

const router = express.Router();
router.use(requireSession);

// GET /api/trades — all pending incoming offers across leagues, value-analyzed.
router.get('/trades', async (req, res, next) => {
  try {
    res.json(await trades.getOverview(req.mflCookie, req.token));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:id/trade/preview — leagues where this player is a trade target
// (on another team), with the owner + a suggested give-package per league.
router.get('/players/:id/trade/preview', async (req, res, next) => {
  try {
    res.json(await trades.crossLeaguePreview(req.mflCookie, req.token, req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/players/:id/trade — send the offer for this player in each selected
// league. Body: { leagues: [{ leagueId, partnerFranchiseId, giveIds }] }.
router.post('/players/:id/trade', async (req, res, next) => {
  try {
    res.json(await trades.crossLeaguePropose(req.mflCookie, req.token, req.params.id, (req.body || {}).leagues));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades — one league's offers + partners for proposing.
router.get('/leagues/:leagueId/trades', async (req, res, next) => {
  try {
    res.json(await trades.getLeague(req.mflCookie, req.token, req.params.leagueId));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades/suggest?target=&partner= — a fair, needs-fitting
// give-package to acquire `target` from `partner`.
router.get('/leagues/:leagueId/trades/suggest', async (req, res, next) => {
  try {
    res.json(await trades.suggestFor(req.mflCookie, req.token, req.params.leagueId, req.query.target, req.query.partner));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades/counter?offer= — a value-balanced counter to an
// incoming offer, keeping its construction (same players + one balancing tweak).
router.get('/leagues/:leagueId/trades/counter', async (req, res, next) => {
  try {
    res.json(await trades.counterFor(req.mflCookie, req.token, req.params.leagueId, req.query.offer));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/trades — propose a trade.
router.post('/leagues/:leagueId/trades', async (req, res, next) => {
  try {
    res.json(await trades.propose(req.mflCookie, req.token, req.params.leagueId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/trades/:tradeId/respond — accept or reject.
router.post('/leagues/:leagueId/trades/:tradeId/respond', async (req, res, next) => {
  try {
    res.json(await trades.respond(req.mflCookie, req.token, req.params.leagueId, req.params.tradeId, (req.body || {}).action));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
