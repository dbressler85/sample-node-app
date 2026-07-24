'use strict';
// IR + Taxi-squad roster moves (owner-accessible MFL `ir` / `taxi_squad` imports). Round-trips
// through the API in demo (overlay reflects the move on the roster): deactivate → IR, activate →
// active, demote → taxi, promote → active.
process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-irtaxi-${process.pid}-${Date.now()}`);

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const ids = (arr) => (arr || []).map((p) => String(p.id));

(async () => {
  const app = require('../../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (p, o) => (await fetch(`${base}${p}`, o)).json();
  try {
    const { token } = await j('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo' }),
    });
    const H = { Authorization: `Bearer ${token}` };
    const JH = { ...H, 'Content-Type': 'application/json' };

    // On Deck flags an illegal IR: a healthy (ACTIVE) player parked on Injured Reserve. The demo
    // fixture has one, so it should surface as an action item before we move anyone.
    const od = await j('/api/ondeck', { headers: H });
    const irv = (od.items || []).find((i) => i.type === 'ir_violation');
    assert(irv && irv.kind === 'action' && irv.action === 'roster', `On Deck surfaces an ir_violation action, got ${JSON.stringify(irv)}`);
    assert(Array.isArray(irv.players) && irv.players.length >= 1 && /IR/i.test(irv.detail), 'the violation names the healthy-on-IR player(s)');
    console.log('✓ On Deck flags a healthy player sitting on IR (illegal IR)');

    // Pick a league that has a bench, an IR slot, and a taxi slot in the fixture.
    const { leagues } = await j('/api/leagues', { headers: H });
    let lg = null, r0 = null;
    for (const l of leagues) {
      const r = await j(`/api/leagues/${l.leagueId}/roster`, { headers: H });
      if (r.bench && r.bench.length && r.ir && r.ir.length && r.taxi && r.taxi.length) { lg = l.leagueId; r0 = r; break; }
    }
    assert(lg, 'found a demo league with bench + IR + taxi players');

    const benchId = ids(r0.bench)[0];
    const irId = ids(r0.ir)[0];
    const taxiId = ids(r0.taxi)[0];

    // Deactivate a bench player → he lands on IR.
    const r1 = await j(`/api/leagues/${lg}/ir`, { method: 'POST', headers: JH, body: JSON.stringify({ deactivate: [benchId] }) });
    assert(ids(r1.ir).includes(benchId) && !ids(r1.bench).includes(benchId), 'deactivate moves a player to IR');
    // Activate the original IR player → he lands on the active roster (bench).
    const r2 = await j(`/api/leagues/${lg}/ir`, { method: 'POST', headers: JH, body: JSON.stringify({ activate: [irId] }) });
    assert(ids(r2.bench).includes(irId) && !ids(r2.ir).includes(irId), 'activate moves a player off IR to active');
    console.log('✓ IR: deactivate → IR, activate → active');

    // Demote a bench player → taxi; promote the original taxi player → active.
    const r3 = await j(`/api/leagues/${lg}/taxi`, { method: 'POST', headers: JH, body: JSON.stringify({ demote: [ids(r2.bench)[0]] }) });
    assert(ids(r3.taxi).includes(ids(r2.bench)[0]), 'demote moves a player to the taxi squad');
    const r4 = await j(`/api/leagues/${lg}/taxi`, { method: 'POST', headers: JH, body: JSON.stringify({ promote: [taxiId] }) });
    assert(ids(r4.bench).includes(taxiId) && !ids(r4.taxi).includes(taxiId), 'promote moves a player off taxi to active');
    console.log('✓ Taxi: demote → taxi, promote → active');
  } finally {
    server.close();
  }

  console.log('\nIR / TAXI HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
