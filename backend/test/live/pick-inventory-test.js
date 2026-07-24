'use strict';
// Cross-league draft-pick inventory: every pick you own (this-year draft slots + future picks),
// value-tagged and grouped by year. Read-only scouting view of your pick capital.
process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-picks-${process.pid}-${Date.now()}`);

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

    const inv = await (await fetch(`${base}/api/picks`, { headers: h })).json();
    assert(inv.summary && inv.summary.total > 0, 'inventory has picks');
    assert(inv.summary.leagues >= 1, 'summary counts leagues');
    assert(inv.summary.totalValue > 0 && inv.summary.firsts >= 1, `summary totals value + firsts, got ${JSON.stringify(inv.summary)}`);
    assert(Array.isArray(inv.byYear) && inv.byYear.length >= 1, 'picks grouped by year');

    // Years are ascending, each group carries its own value subtotal, and each pick is value-tagged.
    const years = inv.byYear.map((y) => y.year);
    assert(years.every((y, i) => i === 0 || y >= years[i - 1]), `years ascending, got ${years}`);
    const totalFromGroups = inv.byYear.reduce((s, y) => s + y.value, 0);
    assert(totalFromGroups === inv.summary.totalValue, `group values sum to the total, ${totalFromGroups} vs ${inv.summary.totalValue}`);
    const allPicks = inv.byYear.flatMap((y) => y.picks);
    assert(allPicks.length === inv.summary.total, 'every pick appears under a year');
    assert(allPicks.every((p) => p.token && p.label && typeof p.value === 'number'), 'each pick carries a token, label, and value');
    // Future picks (rounds only) and this-year draft slots both appear.
    assert(allPicks.some((p) => p.kind === 'future'), 'future-season picks present');
    console.log('✓ /api/picks returns a value-tagged, year-grouped pick inventory');
  } finally {
    server.close();
  }

  console.log('\nPICK INVENTORY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
