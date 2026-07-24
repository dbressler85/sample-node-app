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

// GET /api/picks — every draft pick you own across all leagues (value-tagged, grouped by year).
router.get('/picks', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.PickInventory, await draft.getPickInventory(req.mflCookie, req.account), 'GET /picks'));
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

// GET /api/leagues/:leagueId/draftlist?position= — the owner's ranked My Draft List for a league
// (pre-draft shortlist / auto-pick queue) + a pool to add from.
router.get('/leagues/:leagueId/draftlist', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.DraftList, await draft.getDraftList(req.mflCookie, req.account, req.params.leagueId, { position: req.query.position }), 'GET /leagues/:leagueId/draftlist'));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/draftlist — replace the whole ranked list { players: [id,...] }.
router.post('/leagues/:leagueId/draftlist', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.DraftList, await draft.saveDraftList(req.mflCookie, req.account, req.params.leagueId, (req.body || {}).players), 'POST /leagues/:leagueId/draftlist'));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/draft/pick — make a pick { playerId, comments? }.
router.post('/leagues/:leagueId/draft/pick', async (req, res, next) => {
  try {
    const { playerId, comments } = req.body || {};
    res.json(await draft.makePick(req.mflCookie, req.account, req.params.leagueId, playerId, comments));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
