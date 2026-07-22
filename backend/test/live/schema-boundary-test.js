'use strict';

// Enforcement for the API response contracts (src/lib/apiSchema.js). Two halves:
//
//  1. DRIFT FAILS CI — boot the app in demo mode, hit each wired endpoint, and STRICT-parse the
//     real payload against its schema. If a service renames/drops a relied-on field, the parse
//     throws here (a failed test) instead of silently breaking a mobile screen. This is the hard
//     enforcement the fail-soft runtime path deliberately doesn't do.
//
//  2. RUNTIME IS FAIL-SOFT — checkResponse must never throw and never alter the payload, even on
//     drift; it only logs. A schema mistake or an unforeseen live shape can't become a 500 or a
//     stripped response (UX_GUARDRAILS C4/C5).

process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-schema-${process.pid}-${Date.now()}`);

const app = require('../../src/app');
const { schemas, checkResponse } = require('../../src/lib/apiSchema');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // --- 1. real demo payloads must satisfy their schemas (strict) ---
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, h) => (await fetch(`${base}${p}`, h)).json();

  try {
    const login = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo' }),
    })).json();
    const h = { headers: { Authorization: `Bearer ${login.token}` } };

    const dashboard = await get('/api/dashboard', h);
    schemas.Dashboard.parse(dashboard); // throws on drift
    const leagueId = dashboard.leagues[0].leagueId;

    schemas.Leagues.parse(await get('/api/leagues', h));
    schemas.Roster.parse(await get(`/api/leagues/${leagueId}/roster`, h));
    schemas.Standings.parse(await get(`/api/leagues/${leagueId}/standings`, h));
    schemas.Portfolio.parse(await get('/api/portfolio', h));
    schemas.Scoreboard.parse(await get('/api/scoreboard', h));
    schemas.Lineups.parse(await get('/api/lineups', h));
    schemas.Me.parse(await get('/api/me', h));

    const rankings = await get('/api/players/rankings', h);
    schemas.Rankings.parse(rankings);
    schemas.Profile.parse(await get(`/api/players/${rankings.players[0].id}`, h));

    schemas.WaiversOverview.parse(await get('/api/waivers/overview', h));
    schemas.WaiversBest.parse(await get('/api/waivers/best-available', h));
    schemas.WaiversPending.parse(await get('/api/waivers/pending', h));
    schemas.Watchlist.parse(await get('/api/watchlist', h));
    schemas.WatchlistAlerts.parse(await get('/api/watchlist/alerts', h));

    console.log('✓ demo payloads satisfy all 15 wired schemas');
  } finally {
    server.close();
  }

  // --- 2. checkResponse is fail-soft: same bytes back, no throw, on both pass and drift ---
  const good = { leagues: [{ leagueId: '1', name: 'X', franchiseId: '2', pinned: false }] };
  assert(checkResponse(schemas.Leagues, good, 'test/good') === good, 'valid payload returned by identity');

  const drifted = { leagues: [{ leagueId: '1', naem: 'typo', franchiseId: '2', pinned: false }] }; // name -> naem
  let threw = false;
  let returned;
  const origWarn = console.warn;
  let warned = '';
  console.warn = (m) => { warned += String(m); };
  try {
    returned = checkResponse(schemas.Leagues, drifted, 'test/drift');
  } catch (e) {
    threw = true;
  } finally {
    console.warn = origWarn;
  }
  assert(!threw, 'checkResponse never throws on drift (fail-soft)');
  assert(returned === drifted, 'drifted payload returned UNCHANGED (never stripped)');
  assert(/schema drift/.test(warned) && /test\/drift/.test(warned), 'drift is logged with the label');

  // A dropped/renamed field is genuinely caught by the schema (guards against a no-op schema).
  assert(schemas.Leagues.safeParse(drifted).success === false, 'renamed field fails the schema');

  console.log('✓ checkResponse fail-soft: identity on pass, logs + identity on drift, never throws');
  console.log('\nSCHEMA BOUNDARY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
