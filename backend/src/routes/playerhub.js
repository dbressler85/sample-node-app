'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const hub = require('../services/playerhub');

const router = express.Router();
router.use(requireSession);

// GET /api/players/search?q=&position=&status=  (status: mine|free|available)
router.get('/players/search', async (req, res, next) => {
  try {
    res.json(await hub.search(req.mflCookie, req.token, { q: req.query.q, position: req.query.position, status: req.query.status }));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/rankings?type=value|position|trending|rookies&position=
router.get('/players/rankings', async (req, res, next) => {
  try {
    res.json(await hub.rankings(req.mflCookie, req.token, { type: req.query.type, position: req.query.position }));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:id/add/preview — one claim preview per league he's free in.
router.get('/players/:id/add/preview', async (req, res, next) => {
  try {
    res.json(await hub.previewAdd(req.mflCookie, req.token, req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/players/:id/add — claim across chosen leagues. Body: { leagues:[{leagueId,dropId?,bid?}] }
router.post('/players/:id/add', async (req, res, next) => {
  try {
    res.json(await hub.submitAdd(req.mflCookie, req.token, req.params.id, (req.body && req.body.leagues) || []));
  } catch (err) {
    next(err);
  }
});

// POST /api/players/:id/drop — drop across chosen leagues. Body: { leagues:[leagueId] }
router.post('/players/:id/drop', async (req, res, next) => {
  try {
    res.json(await hub.submitDrop(req.mflCookie, req.token, req.params.id, (req.body && req.body.leagues) || []));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:id — full profile. (Registered last so static paths win.)
router.get('/players/:id', async (req, res, next) => {
  try {
    res.json(await hub.profile(req.mflCookie, req.token, req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
