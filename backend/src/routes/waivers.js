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

// POST /api/waivers/overview — same summary, but each league's freeAgents pool is supplied by the DEVICE
// (fetched straight from MFL on-device). Body: { deviceReads: { [leagueId]: <freeAgents units> } }.
router.post('/waivers/overview', async (req, res, next) => {
  try {
    const { deviceReads } = req.body || {};
    res.json(checkResponse(schemas.WaiversOverview, await waivers.getOverview(req.mflCookie, req.account, { deviceReads: deviceReads || null }), 'POST /waivers/overview'));
  } catch (err) {
    next(err);
  }
});

// GET /api/waivers/suggestions — league-by-league pickup suggestions (wizard, all at once).
router.get('/waivers/suggestions', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.WaiverSuggestions, await waivers.getSuggestions(req.mflCookie, req.account), 'GET /waivers/suggestions'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/waivers/suggestion — ONE league's wizard suggestion. The wizard loads these
// on demand (current + prefetch next) so the first step paints fast instead of blocking on every league.
router.get('/leagues/:leagueId/waivers/suggestion', async (req, res, next) => {
  try {
    res.json(await waivers.getLeagueSuggestion(req.mflCookie, req.account, req.params.leagueId));
  } catch (err) {
    next(err);
  }
});

// GET /api/waivers/best-available — top free agents across all your leagues.
// `?format=1qb|sf` re-prices the board through that value lens (matches the Players screen toggle).
router.get('/waivers/best-available', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.WaiversBest, await waivers.getBestAvailable(req.mflCookie, req.account, { format: req.query.format || null, tep: req.query.tep }), 'GET /waivers/best-available'));
  } catch (err) {
    next(err);
  }
});

// POST /api/waivers/best-available — same board, but the per-league freeAgents pools are supplied by the
// DEVICE (fetched straight from MFL on-device) so the heaviest fan-out leaves the shared IP. Body:
// { deviceReads: { [leagueId]: <freeAgents units> } }. Settings/enrichment/merge stay on the backend.
// `?format=1qb|sf` re-prices the board through that value lens.
router.post('/waivers/best-available', async (req, res, next) => {
  try {
    const { deviceReads } = req.body || {};
    res.json(checkResponse(schemas.WaiversBest, await waivers.getBestAvailable(req.mflCookie, req.account, { deviceReads: deviceReads || null, format: req.query.format || null, tep: req.query.tep }), 'POST /waivers/best-available'));
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
    res.json(checkResponse(schemas.WaiverBoard, await waivers.getBoard(req.mflCookie, req.account, req.params.leagueId, { position: req.query.position, sort: req.query.sort }), 'GET /leagues/:leagueId/waivers'));
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

// POST /api/leagues/:leagueId/waivers/reorder — reorder pending claims (priority order for contingent
// bids). Body: { order: [claimId, ...] } — the desired top-to-bottom sequence.
router.post('/leagues/:leagueId/waivers/reorder', async (req, res, next) => {
  try {
    res.json(await waivers.reorder(req.mflCookie, req.account, req.params.leagueId, (req.body || {}).order));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
