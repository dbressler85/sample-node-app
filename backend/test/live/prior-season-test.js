'use strict';

// Player card — prior-season totals. Two halves:
//   1. DEMO: the profile carries `priorSeason` (last completed year's fantasy totals), stamped
//      with the concrete year (config.season − 1) from the demo fixture.
//   2. YEAR OVERRIDE: mflRepo.playerScores forwards a `year` to mfl.exportRequest so a prior-year
//      read targets the previous season's URL path, and the read cache keys it separately.

process.env.MFL_DEMO_MODE = 'true';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-prior-${process.pid}-${Date.now()}`);

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const config = require('../../src/config');

(async () => {
  const app = require('../../src/app');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'demo' }),
    })).json();
    const h = { headers: { Authorization: `Bearer ${login.token}` } };

    // '13593' has a prior-season fixture (268.4 pts / 16 g).
    const p = await (await fetch(`${base}/api/players/13593`, h)).json();
    assert(p.priorSeason, 'profile carries priorSeason');
    assert(p.priorSeason.year === Number(config.season) - 1, `prior year = ${Number(config.season) - 1}, got ${p.priorSeason.year}`);
    assert(p.priorSeason.points === 268.4, `prior points 268.4, got ${p.priorSeason.points}`);
    assert(p.priorSeason.games === 16 && p.priorSeason.ppg != null, 'prior games + ppg present');
    // Box score: 13593 is a WR → a receiving line with rec/yds/td, no passing/rushing.
    assert(p.priorSeason.stats && p.priorSeason.stats.receiving, 'prior season carries a receiving box score');
    const rec = p.priorSeason.stats.receiving;
    assert(rec.rec === 103 && rec.yds === 1533 && rec.td === 10, `receiving line, got ${JSON.stringify(rec)}`);
    assert(!p.priorSeason.stats.passing && !p.priorSeason.stats.rushing, 'a WR shows no passing/rushing line');
    console.log('✓ demo profile carries prior-season totals + box score stamped with the prior year');

    // A QB (13116) shows passing + rushing lines.
    const qb = await (await fetch(`${base}/api/players/13116`, h)).json();
    assert(qb.priorSeason.stats.passing.att === 560 && qb.priorSeason.stats.passing.cmp === 372 && qb.priorSeason.stats.passing.yds === 4210 && qb.priorSeason.stats.passing.td === 33, `QB passing line, got ${JSON.stringify(qb.priorSeason.stats.passing)}`);
    assert(qb.priorSeason.stats.rushing.att === 88 && qb.priorSeason.stats.rushing.td === 6, 'QB rushing line');
    console.log('✓ a QB shows passing + rushing box-score lines');
  } finally {
    server.close();
  }

  // --- year override threads through the repo to the exporter ---
  delete require.cache[require.resolve('../../src/lib/mfl')];
  delete require.cache[require.resolve('../../src/lib/mflRepo')];
  const mfl = require('../../src/lib/mfl');
  const mflRepo = require('../../src/lib/mflRepo');
  let seen = null;
  mfl.exportRequest = async (type, opts = {}) => {
    seen = { type, ...opts };
    return { playerScores: { playerScore: [{ id: '13593', score: '268.4' }] } };
  };
  const rows = await mflRepo.playerScores(
    { host: 'www.myfantasyleague.com', leagueId: '12345' },
    'ck',
    { W: 'YTD', PLAYERS: '13593', year: 2024 }
  );
  assert(seen && seen.year === 2024, `year forwarded to exportRequest, got ${seen && seen.year}`);
  assert(seen.W === 'YTD' && seen.PLAYERS === '13593', 'W + PLAYERS forwarded');
  assert(rows[0] && rows[0].id === '13593', 'rows unwrapped');
  console.log('✓ mflRepo.playerScores forwards a prior-year `year` override to the exporter');

  // --- Sleeper season-stats mapping (box score) ---
  const seasonStats = require('../../src/lib/seasonStats');
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      // A WR (only receiving) and a QB (passing + rushing), plus an all-zero row that's dropped.
      wr1: { rec: 100, rec_yd: 1400, rec_td: 9, rec_tgt: 150, gp: 17, rush_att: 0, pass_att: 0 },
      qb1: { pass_att: 500, pass_cmp: 330, pass_yd: 4100, pass_td: 30, pass_int: 10, rush_att: 60, rush_yd: 300, rush_td: 4, gp: 16 },
      empty: { pass_att: 0, rush_att: 0, rec: 0 },
    }),
  });
  const map = await seasonStats.bySleeperId(2024);
  const wr = map.get('wr1');
  assert(wr && wr.receiving && wr.receiving.rec === 100 && wr.receiving.yds === 1400 && wr.receiving.td === 9, `WR receiving mapped, got ${JSON.stringify(wr)}`);
  assert(!wr.passing && !wr.rushing && wr.gp === 17, 'WR: no passing/rushing, games mapped');
  const qbBox = map.get('qb1');
  assert(qbBox.passing.att === 500 && qbBox.passing.cmp === 330 && qbBox.passing.yds === 4100 && qbBox.passing.td === 30, 'QB passing mapped');
  assert(qbBox.rushing.att === 60 && qbBox.rushing.yds === 300 && qbBox.rushing.td === 4, 'QB rushing mapped');
  assert(!map.has('empty'), 'an all-zero stat row is dropped');
  console.log('✓ seasonStats maps Sleeper season stats to a per-category box score');

  console.log('\nPRIOR SEASON HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
