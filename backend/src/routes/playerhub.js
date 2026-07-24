'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const hub = require('../services/playerhub');
const playerTags = require('../store/playerTags');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/tags — the owner's Target/Avoid tags, keyed by playerId. Used to overlay
// personal value across the value-based surfaces.
router.get('/tags', (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Tags, { tags: playerTags.all(req.account) }, 'GET /tags'));
  } catch (err) {
    next(err);
  }
});

// POST /api/players/:id/tag — set (or clear) a player's tag. Body: { tag: 'target' | 'avoid' | null }.
router.post('/players/:id/tag', (req, res, next) => {
  try {
    const tag = playerTags.set(req.account, req.params.id, req.body && req.body.tag);
    res.json({ ok: true, id: String(req.params.id), tag });
  } catch (err) {
    next(err);
  }
});

// GET /api/players/search?q=&position=&status=&format=  (status: mine|free|available; format: sf|1qb)
router.get('/players/search', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Search, await hub.search(req.mflCookie, req.account, { q: req.query.q, position: req.query.position, status: req.query.status, format: req.query.format }), 'GET /players/search'));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/rankings?type=value|position|trending|rookies&position=&format=sf|1qb&offset=&limit=
router.get('/players/rankings', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Rankings, await hub.rankings(req.mflCookie, req.account, { type: req.query.type, position: req.query.position, format: req.query.format, offset: req.query.offset, limit: req.query.limit }), 'GET /players/rankings'));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/compare?ids=a,b,c — side-by-side comparison of up to 4 players.
// (Declared before /players/:id so "compare" isn't swallowed as an id.)
router.get('/players/compare', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    res.json(checkResponse(schemas.Compare, await hub.compare(req.mflCookie, req.account, ids), 'GET /players/compare'));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:id/add/preview — one claim preview per league he's free in.
router.get('/players/:id/add/preview', async (req, res, next) => {
  try {
    res.json(await hub.previewAdd(req.mflCookie, req.account, req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/players/:id/add — claim across chosen leagues. Body: { leagues:[{leagueId,dropId?,bid?}] }
router.post('/players/:id/add', async (req, res, next) => {
  try {
    res.json(await hub.submitAdd(req.mflCookie, req.account, req.params.id, (req.body && req.body.leagues) || []));
  } catch (err) {
    next(err);
  }
});

// POST /api/players/:id/drop — drop across chosen leagues. Body: { leagues:[leagueId] }
router.post('/players/:id/drop', async (req, res, next) => {
  try {
    res.json(await hub.submitDrop(req.mflCookie, req.account, req.params.id, (req.body && req.body.leagues) || []));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:id — full profile. (Registered last so static paths win.)
router.get('/players/:id', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Profile, await hub.profile(req.mflCookie, req.account, req.params.id), 'GET /players/:id'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
