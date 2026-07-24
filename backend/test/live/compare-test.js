'use strict';
// Side-by-side player comparison: up to 4 players, each with the trade-weighing fields
// (value, age, ranks, ownership, trend, availability) and last-season stats. Caps at 4 and
// dedupes ids.
process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-compare-${process.pid}-${Date.now()}`);

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const app = require('../../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { token } = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo' }),
    })).json();
    const h = { Authorization: `Bearer ${token}` };

    const r = await (await fetch(`${base}/api/players/compare?ids=13593,11686`, { headers: h })).json();
    assert(Array.isArray(r.players) && r.players.length === 2, `two players compared, got ${r.players && r.players.length}`);
    const jj = r.players.find((p) => p.name && p.name.indexOf('Jefferson') >= 0);
    assert(jj, 'Justin Jefferson resolves');
    assert(typeof jj.value === 'number' && typeof jj.age === 'number' && jj.posRank != null, `carries value/age/posRank, got ${JSON.stringify({ v: jj.value, a: jj.age, pr: jj.posRank })}`);
    assert(jj.priorSeason && jj.priorSeason.stats && jj.priorSeason.stats.receiving && jj.priorSeason.stats.receiving.rec > 0, 'carries a prior-season receiving line');
    console.log('✓ compare returns value/age/rank + prior-season stats per player');

    // Dedupe + cap at 4.
    const dup = await (await fetch(`${base}/api/players/compare?ids=13593,13593`, { headers: h })).json();
    assert(dup.players.length === 1, 'duplicate ids collapse to one');
    const many = await (await fetch(`${base}/api/players/compare?ids=13593,11686,11675,13609,14801,15265`, { headers: h })).json();
    assert(many.players.length <= 4, `caps at 4 players, got ${many.players.length}`);
    console.log('✓ compare dedupes ids and caps at four');

    // Empty / unknown ids degrade gracefully.
    const empty = await (await fetch(`${base}/api/players/compare?ids=`, { headers: h })).json();
    assert(Array.isArray(empty.players) && empty.players.length === 0, 'no ids → empty list');
    console.log('✓ compare handles an empty id list');
  } finally {
    server.close();
  }

  console.log('\nCOMPARE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
