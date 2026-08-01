'use strict';

const express = require('express');
const config = require('../config');
const metrics = require('../lib/metrics');
const requireSession = require('../middleware/auth');
const portfolio = require('../services/portfolio');
const scoreboard = require('../services/scoreboard');
const exposure = require('../services/exposure');
const ondeck = require('../services/ondeck');
const leaguesService = require('../services/leagues');
const mflRead = require('../lib/mflRead');
const shadowParity = require('../lib/shadowParity');
const { schemas, checkResponse } = require('../lib/apiSchema');

const router = express.Router();
router.use(requireSession);

// GET /api/session/mfl-cookie — hand the authenticated device ITS OWN MFL session cookie so the app can
// read per-user data straight from MFL (device-origin: its own IP + rate budget — docs/DEVICE_ORIGIN_MFL.md).
// Gated behind config.deviceReadsEnabled (404 when off) and, of course, requireSession — so it only ever
// returns the cookie to the session's own authenticated owner, never a third party. The device stores it
// in SecureStore and wipes it on logout. `host`/`season` let the device build correctly-targeted reads.
router.get('/session/mfl-cookie', (req, res) => {
  if (!config.deviceReadsEnabled) return res.status(404).json({ error: 'Not found' });
  // Hand the device the REGISTERED User-Agent (A-3) so its on-device MFL reads send the same validated
  // client identity the backend does — never a hardcoded string that forfeits the registered-client limit.
  // Also hand it the SAME throttle envelope the backend runs (A-1): concurrency + stagger are tuned to the
  // registered per-IP ceiling (e.g. 8 / 75ms with the API key), and the device is its own IP sending the
  // same UA — so it should pace to the same envelope. Sourced here (not hardcoded on the device) so a
  // re-tune or a higher registered limit follows automatically, no app rebuild.
  res.json({
    cookie: req.mflCookie,
    season: config.season,
    host: config.apiHost,
    userAgent: config.userAgent,
    readConcurrency: config.mflMaxConcurrent,
    readStaggerMs: config.mflMinRequestIntervalMs,
  });
});

// POST /api/metrics/device-read { read, source } — a best-effort beacon the app fires after serving a
// read, so /_metrics can show how often each read was served ON-DEVICE vs. fell back to the backend
// (the device-origin payoff, measured — docs/DEVICE_ORIGIN_MFL.md). Fire-and-forget; never errors.
router.post('/metrics/device-read', (req, res) => {
  const { read, source, ms, reason, ver } = req.body || {};
  if (read && (source === 'device' || source === 'backend')) metrics.recordDeviceRead(read, source, { ms, reason });
  // A-6: the device reports its shared-core (mflRead) version; record the distribution + flag any client
  // OLDER than this backend, so a stale-app population (whose Shape-A screens the backend can't correct) is
  // visible on /_metrics rather than silent.
  if (ver != null) metrics.recordDeviceVersion(ver, Number(ver) < mflRead.VERSION);
  res.json({ ok: true });
});

// GET /api/me — the signed-in manager's identity + league count, for the Profile screen.
// Kept lightweight (identity + a cached league count); the profile composes value/outlook
// from /api/portfolio and activity from /api/watchlist client-side.
router.get('/me', async (req, res, next) => {
  try {
    const leagues = await leaguesService.orderedLeagues(req.mflCookie, req.account).catch(() => []);
    const username = (req.session && req.session.username) || null;
    // Comped accounts (PRO_WHITELIST) get full Pro without subscribing — the app trusts this flag.
    const pro = !!(username && config.proWhitelist.includes(String(username).toLowerCase()));
    res.json(checkResponse(schemas.Me, {
      username,
      account: req.account,
      season: config.season,
      demoMode: config.demoMode,
      leagues: leagues.length,
      pro,
    }, 'GET /me'));
  } catch (err) {
    next(err);
  }
});

// GET /api/ondeck — time-sorted deadlines across leagues (draft clocks, lineup
// locks, scheduled drafts, waiver runs). The proactive "what needs me next" view.
router.get('/ondeck', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.OnDeck, await ondeck.getOnDeck(req.mflCookie, req.account), 'GET /ondeck'));
  } catch (err) {
    next(err);
  }
});

// GET /api/home — portfolio roll-up + cross-league triage queue (server-side).
router.get('/home', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Home, await portfolio.getHome(req.mflCookie, req.account), 'GET /home'));
  } catch (err) {
    next(err);
  }
});

// POST /api/home — same roll-up, but the per-league rosters are supplied by the DEVICE.
// Body: { deviceReads: { [leagueId]: <rosters> } }.
router.post('/home', async (req, res, next) => {
  try {
    const { deviceReads } = req.body || {};
    res.json(checkResponse(schemas.Home, await portfolio.getHome(req.mflCookie, req.account, { deviceReads: deviceReads || null }), 'POST /home'));
  } catch (err) {
    next(err);
  }
});

// POST /api/home/league/:leagueId — one league's triage, roster supplied by the DEVICE.
// Body: { deviceRosters: <rosters> }.
router.post('/home/league/:leagueId', async (req, res, next) => {
  try {
    const { deviceRosters } = req.body || {};
    res.json(checkResponse(schemas.HomeLeague, await portfolio.getLeagueTriage(req.mflCookie, req.account, req.params.leagueId, { deviceRosters: deviceRosters || null }), 'POST /home/league/:leagueId'));
  } catch (err) {
    next(err);
  }
});

// GET /api/home/league/:leagueId — one league's triage, for progressive loading.
router.get('/home/league/:leagueId', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.HomeLeague, await portfolio.getLeagueTriage(req.mflCookie, req.account, req.params.leagueId), 'GET /home/league/:leagueId'));
  } catch (err) {
    next(err);
  }
});

// GET /api/portfolio — dynasty value dashboard + value-at-risk across leagues.
router.get('/portfolio', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Portfolio, await portfolio.getDashboard(req.mflCookie, req.account), 'GET /portfolio'));
  } catch (err) {
    next(err);
  }
});

// POST /api/portfolio — same dashboard, but the per-league rosters are supplied by the DEVICE (fetched
// straight from MFL on-device) instead of the backend fanning them out. Body: { deviceRosters: { [leagueId]:
// rawFranchises } }. The heavy all-franchise fan-out leaves the shared IP; all aggregation stays here.
router.post('/portfolio', async (req, res, next) => {
  try {
    const { deviceRosters } = req.body || {};
    res.json(checkResponse(schemas.Portfolio, await portfolio.getDashboard(req.mflCookie, req.account, { deviceRosters: deviceRosters || null }), 'POST /portfolio'));
    // A-6/U-6: fire-and-forget parity self-check on a small SAMPLE of device rosters reads — the backend
    // re-fetches one league and compares against what the device supplied, so a silent divergence is
    // observable on /_metrics. AFTER res.json, never awaited, best-effort (never affects the response).
    if (deviceRosters) shadowParity.sampleRosters(req.mflCookie, deviceRosters, config.deviceParitySampleRate);
  } catch (err) {
    next(err);
  }
});

// POST /api/portfolio/holdings/:playerId/bait — shop (or un-shop) a holding across every
// league you roster him in. Body: { on: bool, leagueIds: [..] }.
router.post('/portfolio/holdings/:playerId/bait', async (req, res, next) => {
  try {
    const { on, leagueIds } = req.body || {};
    res.json(await portfolio.shopHolding(req.mflCookie, req.account, req.params.playerId, !!on, leagueIds));
  } catch (err) {
    next(err);
  }
});

// GET /api/scoreboard — live matchups across leagues, sorted by closeness.
router.get('/scoreboard', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Scoreboard, await scoreboard.getScoreboard(req.mflCookie), 'GET /scoreboard'));
  } catch (err) {
    next(err);
  }
});

// GET /api/leagues/:leagueId/matchup — this week's live matchup for ONE league (the cockpit card).
// Scoped so opening a single league doesn't fan the whole cross-league scoreboard out.
router.get('/leagues/:leagueId/matchup', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.LeagueMatchup, await scoreboard.getLeagueMatchup(req.mflCookie, req.params.leagueId), 'GET /leagues/:leagueId/matchup'));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/exposure — every league you roster each player in.
router.get('/players/exposure', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.Exposure, await exposure.getExposure(req.mflCookie, req.account), 'GET /players/exposure'));
  } catch (err) {
    next(err);
  }
});

// GET /api/news — league news mapped to which of your teams it affects.
router.get('/news', async (req, res, next) => {
  try {
    res.json(checkResponse(schemas.News, await exposure.getNews(req.mflCookie, req.account), 'GET /news'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
