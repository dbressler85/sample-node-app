'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const waivers = require('../services/waivers');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/waivers/overview — per-league waiver summary for the landing list.
router.get('/waivers/overview', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.WaiversOverview, await waivers.getOverview(req.mflCookie, req.account), 'GET /waivers/overview'));
  } catch (err) {
    next(err);
  }
});

// GET /api/waivers/suggestions — league-by-league pickup suggestions (wizard).
router.get('/waivers/suggestions', async (req, res, next) => {
  try {
    res.json(await waivers.getSuggestions(req.mflCookie, req.account));
  } catch (err) {
    next(err);
  }
});

// GET /api/waivers/best-available — top free agents across all your leagues.
router.get('/waivers/best-available', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.WaiversBest, await waivers.getBestAvailable(req.mflCookie, req.account), 'GET /waivers/best-available'));
  } catch (err) {
    next(err);
  }
});

// GET /api/waivers/pending — pending claims + recent results across leagues.
router.get('/waivers/pending', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.WaiversPending, await waivers.getPending(req.mflCookie, req.account), 'GET /waivers/pending'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/waivers?position=&sort= — one league's board.
router.get('/leagues/:leagueId/waivers', async (req, res, next) => {
  try {
    res.json(await waivers.getBoard(req.mflCookie, req.account, req.params.leagueId, { position: req.query.position, sort: req.query.sort }));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/waivers/preview — validate + fill suggestions.
router.post('/leagues/:leagueId/waivers/preview', async (req, res, next) => {
  try {
    res.json(await waivers.preview(req.mflCookie, req.account, req.params.leagueId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/waivers — submit a claim.
router.post('/leagues/:leagueId/waivers', async (req, res, next) => {
  try {
    res.json(await waivers.submit(req.mflCookie, req.account, req.params.leagueId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/waivers/multi/preview — validate a queue of claims with
// FAAB budgeting + roster space across them. Body: { claims: [{ addId, dropId?, bid? }] }.
router.post('/leagues/:leagueId/waivers/multi/preview', async (req, res, next) => {
  try {
    res.json(await waivers.previewMulti(req.mflCookie, req.account, req.params.leagueId, (req.body || {}).claims));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/waivers/multi — submit a whole queue at once.
router.post('/leagues/:leagueId/waivers/multi', async (req, res, next) => {
  try {
    res.json(await waivers.submitMulti(req.mflCookie, req.account, req.params.leagueId, (req.body || {}).claims));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leagues/:leagueId/waivers/:claimId — cancel a pending claim.
router.delete('/leagues/:leagueId/waivers/:claimId', async (req, res, next) => {
  try {
    res.json(await waivers.cancel(req.mflCookie, req.account, req.params.leagueId, req.params.claimId));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
