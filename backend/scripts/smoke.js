'use strict';

// End-to-end smoke test of the backend in DEMO mode. Boots the app on an
// ephemeral port and exercises the full login -> dashboard -> roster flow.
// Run: npm run smoke   (exits non-zero on any failure)

process.env.MFL_DEMO_MODE = 'true';
const app = require('../src/app');

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (res) => ({ status: res.status, body: await res.json() });

  try {
    let r = await j(await fetch(`${base}/api/health`));
    assert(r.status === 200 && r.body.ok, 'health ok');
    assert(r.body.demoMode === true, 'demo mode on');
    console.log('✓ health', r.body);

    r = await j(
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'demo', password: 'demo' }),
      })
    );
    assert(r.status === 200 && r.body.token, 'login returns token');
    const token = r.body.token;
    console.log('✓ login token acquired');

    const authed = { headers: { Authorization: `Bearer ${token}` } };

    r = await j(await fetch(`${base}/api/dashboard`, authed));
    assert(r.status === 200, 'dashboard 200');
    assert(Array.isArray(r.body.leagues) && r.body.leagues.length === 3, 'dashboard has 3 leagues');
    assert(r.body.leagues.every((l) => l.matchup && l.matchup.me), 'every league has a matchup');
    console.log(`✓ dashboard: ${r.body.leagues.length} leagues`);
    for (const l of r.body.leagues) {
      console.log(
        `    - ${l.name} (${l.record}, #${l.standingRank}) ` +
          `${l.matchup.me.score} vs ${l.matchup.opponent.score} [${l.matchup.opponent.name}]`
      );
    }

    const leagueId = r.body.leagues[0].leagueId;
    r = await j(await fetch(`${base}/api/leagues/${leagueId}/roster`, authed));
    assert(r.status === 200, 'roster 200');
    assert(r.body.starters.length > 0, 'roster has starters');
    assert(r.body.starters.every((p) => p.name && !/^Player /.test(p.name)), 'starter names resolved');
    console.log(`✓ roster for ${r.body.name}: ${r.body.starters.length} starters, ${r.body.bench.length} bench`);
    console.log(`    starters: ${r.body.starters.map((p) => `${p.name} (${p.position})`).join(', ')}`);

    r = await j(await fetch(`${base}/api/dashboard`));
    assert(r.status === 401, 'dashboard without token is 401');
    console.log('✓ auth required (401 without token)');

    console.log('\nALL SMOKE CHECKS PASSED');
  } finally {
    server.close();
  }
})().catch((err) => {
  console.error('\nSMOKE FAILED:', err.message);
  process.exit(1);
});
