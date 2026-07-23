'use strict';

const express = require('express');
const requireSession = require('../middleware/auth');
const trades = require('../services/trades');
const tradeDeadlines = require('../store/tradeDeadlines');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/trades — all pending incoming offers across leagues, value-analyzed.
router.get('/trades', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Trades, await trades.getOverview(req.mflCookie, req.account), 'GET /trades'));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:id/trade/preview — leagues where this player is a trade target
// (on another team), with the owner + a suggested give-package per league.
router.get('/players/:id/trade/preview', async (req, res, next) => {
  try {
    // Optional ?leagues=a,b,c — the leagues where the caller already knows he's a target, so
    // we probe only those instead of every league.
    const leagueIds = req.query.leagues ? String(req.query.leagues).split(',').filter(Boolean) : null;
    res.json(await trades.crossLeaguePreview(req.mflCookie, req.account, req.params.id, leagueIds));
  } catch (err) {
    next(err);
  }
});

// POST /api/players/:id/trade — send the offer for this player in each selected
// league. Body: { leagues: [{ leagueId, partnerFranchiseId, giveIds }] }.
router.post('/players/:id/trade', async (req, res, next) => {
  try {
    res.json(await trades.crossLeaguePropose(req.mflCookie, req.account, req.params.id, (req.body || {}).leagues));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades — one league's offers + partners for proposing.
router.get('/leagues/:leagueId/trades', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.LeagueTrades, await trades.getLeague(req.mflCookie, req.account, req.params.leagueId), 'GET /leagues/:leagueId/trades'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades/fit — the "start a trade here" hint (where you're
// deep and rivals need it). Fetched per league in the background by the inbox.
router.get('/leagues/:leagueId/trades/fit', async (req, res, next) => {
  try {
    res.json(await trades.getLeagueFit(req.mflCookie, req.account, req.params.leagueId));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades/suggest?target=&partner= — a fair, needs-fitting
// give-package to acquire `target` from `partner`.
router.get('/leagues/:leagueId/trades/suggest', async (req, res, next) => {
  try {
    res.json(await trades.suggestFor(req.mflCookie, req.account, req.params.leagueId, req.query.target, req.query.partner));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/trade-deadline — set/clear the manual trade deadline. Body:
// { deadline: 'YYYY-MM-DD' | null }. MFL has no machine-readable deadline, so the owner enters it.
router.post('/leagues/:leagueId/trade-deadline', (req, res, next) => {
  try {
    const deadline = tradeDeadlines.set(req.account, req.params.leagueId, req.body && req.body.deadline);
    res.json({ ok: true, leagueId: String(req.params.leagueId), deadline });
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades/deal?partner= — a full deal from zero with `partner`: both
// sides proposed at once (their surplus/bait at your need ⇄ your bait/surplus at their need).
router.get('/leagues/:leagueId/trades/deal', async (req, res, next) => {
  try {
    res.json(await trades.fullDealFor(req.mflCookie, req.account, req.params.leagueId, req.query.partner));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades/ask?send=&partner= — given what you'd SEND (comma-separated
// player/pick ids) to `partner`, a fair return package to ASK FOR (their bait + your needs).
router.get('/leagues/:leagueId/trades/ask', async (req, res, next) => {
  try {
    res.json(await trades.askFor(req.mflCookie, req.account, req.params.leagueId, req.query.send, req.query.partner));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/trades/counter?offer= — a value-balanced counter to an
// incoming offer, keeping its construction (same players + one balancing tweak).
router.get('/leagues/:leagueId/trades/counter', async (req, res, next) => {
  try {
    res.json(await trades.counterFor(req.mflCookie, req.account, req.params.leagueId, req.query.offer));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/trades — propose a trade.
router.post('/leagues/:leagueId/trades', async (req, res, next) => {
  try {
    res.json(await trades.propose(req.mflCookie, req.account, req.params.leagueId, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// POST /api/leagues/:leagueId/trades/:tradeId/respond — accept or reject.
router.post('/leagues/:leagueId/trades/:tradeId/respond', async (req, res, next) => {
  try {
    res.json(await trades.respond(req.mflCookie, req.account, req.params.leagueId, req.params.tradeId, (req.body || {}).action));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
