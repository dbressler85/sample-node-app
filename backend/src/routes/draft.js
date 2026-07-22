'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const draft = require('../services/draft');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/drafts — draft state across every league (scheduled / live / my turn).
router.get('/drafts', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Drafts, await draft.getOverview(req.mflCookie, req.account), 'GET /drafts'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/draft?position= — one league's board + available pool.
router.get('/leagues/:leagueId/draft', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.DraftBoard, await draft.getLeague(req.mflCookie, req.account, req.params.leagueId, { position: req.query.position }), 'GET /leagues/:leagueId/draft'));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/draft/pick — make a pick { playerId }.
router.post('/leagues/:leagueId/draft/pick', async (req, res, next) => {
  try {
    res.json(await draft.makePick(req.mflCookie, req.account, req.params.leagueId, (req.body || {}).playerId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
