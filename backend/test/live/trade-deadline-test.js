'use strict';
// Manual per-league trade deadline (MFL exposes none). Store validation + an API round-trip:
// POST a deadline → it comes back on the trades desk; clear it → gone.
process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-deadline-${process.pid}-${Date.now()}`);

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // --- store validation ---
  const store = require('../../src/store/tradeDeadlines');
  assert(store.set('t', 'L1', '2026-11-15') === '2026-11-15', 'accepts a valid YYYY-MM-DD');
  assert(store.get('t', 'L1') === '2026-11-15', 'reads it back');
  assert(store.set('t', 'L1', 'nov 15') === null, 'rejects a malformed date (cleared)');
  assert(store.set('t', 'L1', '2026-12-01') && store.set('t', 'L1', null) === null, 'null clears');
  assert(store.get('t', 'L1') === null, 'cleared value is gone');
  console.log('✓ store validates the date format and clears on null/garbage');

  // --- MFL calendar carries the deadline (TRADE_DEADLINE event) — read it ---
  const mflRepo = require('../../src/lib/mflRepo');
  const trades = require('../../src/services/trades');
  const soonSec = Math.floor((Date.now() + 20 * 24 * 60 * 60 * 1000) / 1000);
  const pastSec = Math.floor((Date.now() - 5 * 24 * 60 * 60 * 1000) / 1000);
  mflRepo.calendar = async () => [
    { type: 'WAIVER_BBID', start_time: String(soonSec + 100000) },
    { type: 'TRADE_DEADLINE', start_time: String(pastSec) }, // already passed → ignored
    { type: 'TRADE_DEADLINE', start_time: String(soonSec) }, // the upcoming one
  ];
  const dlMs = await trades.nextTradeDeadline('ck', { leagueId: '1', host: 'www.myfantasyleague.com' });
  assert(dlMs === soonSec * 1000, `reads the soonest FUTURE TRADE_DEADLINE, got ${dlMs} vs ${soonSec * 1000}`);
  // Also matches when the type differs but the label says "trade deadline".
  mflRepo.calendar = async () => [{ type: 'CUSTOM', title: 'Trade Deadline', start_time: String(soonSec) }];
  assert((await trades.nextTradeDeadline('ck', { leagueId: '1' })) === soonSec * 1000, 'matches a trade-deadline by label too');
  // No deadline on the calendar → null.
  mflRepo.calendar = async () => [{ type: 'WAIVER_BBID', start_time: String(soonSec) }];
  assert((await trades.nextTradeDeadline('ck', { leagueId: '1' })) === null, 'no trade-deadline event → null');
  console.log('✓ nextTradeDeadline reads MFL’s calendar TRADE_DEADLINE event (soonest future)');

  // --- effectiveDeadline: one resolver, precedence manual → demo fixture ---
  // Demo mode: a league with a fixture deadline resolves to source 'demo'.
  const eff = await trades.effectiveDeadline('ck', 'tk', { leagueId: '64097', host: 'www.myfantasyleague.com' });
  assert(eff && eff.source === 'demo' && eff.at > Date.now(), `effectiveDeadline returns the demo fixture, got ${JSON.stringify(eff)}`);
  // A manual override wins over the fixture.
  store.set('tk', '64097', '2026-10-01');
  const eff2 = await trades.effectiveDeadline('ck', 'tk', { leagueId: '64097' });
  assert(eff2 && eff2.source === 'manual' && eff2.date === '2026-10-01', `manual override wins, got ${JSON.stringify(eff2)}`);
  store.set('tk', '64097', null);
  // A demo league without a fixture deadline resolves to null.
  assert((await trades.effectiveDeadline('ck', 'tk', { leagueId: '40750' })) == null, 'a league with no deadline resolves to null');
  console.log('✓ effectiveDeadline: manual override wins, else demo fixture, else null');

  // --- API round-trip on the trades desk ---
  const app = require('../../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo' }),
    })).json();
    const h = { Authorization: `Bearer ${login.token}` };
    const dash = await (await fetch(`${base}/api/dashboard`, { headers: h })).json();
    const leagueId = dash.leagues[0].leagueId;

    let desk = await (await fetch(`${base}/api/leagues/${leagueId}/trades`, { headers: h })).json();
    assert(desk.tradeDeadline == null, 'no deadline set initially');

    const setRes = await (await fetch(`${base}/api/leagues/${leagueId}/trade-deadline`, {
      method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ deadline: '2026-11-15' }),
    })).json();
    assert(setRes.ok && setRes.deadline === '2026-11-15', 'POST sets the deadline');

    desk = await (await fetch(`${base}/api/leagues/${leagueId}/trades`, { headers: h })).json();
    assert(desk.tradeDeadline === '2026-11-15', 'the desk now carries the deadline');

    const clr = await (await fetch(`${base}/api/leagues/${leagueId}/trade-deadline`, {
      method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ deadline: null }),
    })).json();
    assert(clr.deadline === null, 'POST null clears the deadline');
    console.log('✓ deadline round-trips through the API onto the trades desk');

    // --- demo fixture surfaces on Home triage + the portfolio breakdown (the countdown chip) ---
    const triage = await (await fetch(`${base}/api/home/league/64097`, { headers: h })).json();
    assert(triage.tradeDeadline && triage.tradeDeadline.source === 'demo' && /^\d{4}-\d{2}-\d{2}$/.test(triage.tradeDeadline.date),
      `home triage carries the demo deadline, got ${JSON.stringify(triage.tradeDeadline)}`);
    const port = await (await fetch(`${base}/api/portfolio`, { headers: h })).json();
    const row = (port.byLeague || []).find((l) => l.leagueId === '64097');
    assert(row && row.tradeDeadline && row.tradeDeadline.at > Date.now(), `portfolio byLeague carries an upcoming deadline, got ${JSON.stringify(row && row.tradeDeadline)}`);
    const noDl = (port.byLeague || []).find((l) => l.leagueId === '40750');
    assert(noDl && noDl.tradeDeadline == null, 'a league without a fixture deadline reports null');
    console.log('✓ demo deadline surfaces on Home triage + portfolio breakdown');
  } finally {
    server.close();
  }

  console.log('\nTRADE DEADLINE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
