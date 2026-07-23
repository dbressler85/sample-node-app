'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const tradebait = require('../services/tradebait');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/tradebait — everything on the block across your leagues, grouped by league.
router.get('/tradebait', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.TradeBait, await tradebait.getBlock(req.mflCookie, req.account), 'GET /tradebait'));
  } catch (err) {
    next(err);
  }
});

// GET /api/tradebait/market — what every OTHER franchise is shopping across your leagues.
router.get('/tradebait/market', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.TradeMarket, await tradebait.getMarket(req.mflCookie, req.account), 'GET /tradebait/market'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/tradebait — ids on the block in one league (to mark rosters).
router.get('/leagues/:leagueId/tradebait', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.LeagueTradeBait, await tradebait.leagueIds(req.mflCookie, req.account, req.params.leagueId), 'GET /leagues/:leagueId/tradebait'));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/tradebait/:playerId — put a player on the block (body: { note }).
router.post('/leagues/:leagueId/tradebait/:playerId', async (req, res, next) => {
  try {
    res.json(await tradebait.add(req.mflCookie, req.account, req.params.leagueId, req.params.playerId, req.body && req.body.note));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leagues/:leagueId/tradebait/:playerId — take a player off the block.
router.delete('/leagues/:leagueId/tradebait/:playerId', async (req, res, next) => {
  try {
    res.json(await tradebait.remove(req.mflCookie, req.account, req.params.leagueId, req.params.playerId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
