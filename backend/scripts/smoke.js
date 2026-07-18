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

    // --- M2 / M2.5: lineups ---
    r = await j(await fetch(`${base}/api/lineups?mode=auto`, authed));
    assert(r.status === 200, 'lineups overview 200');
    assert(r.body.leagues.length === 3, 'lineups overview has 3 leagues');
    const before = r.body.summary;
    assert(before.needAttention >= 1, 'at least one league needs attention');
    assert(before.risky >= 1, 'at least one league has an unavailable current starter (risk)');
    assert(r.body.leagues[0].status === 'risk', 'most urgent (risk) league sorts first');
    console.log(
      `✓ lineups overview: ${before.needAttention}/${before.total} need attention, ` +
        `${before.risky} risky, +${before.pointsAvailable} pts available`
    );
    for (const l of r.body.leagues) {
      const w = (l.warnings || []).map((x) => `${x.name}${x.status ? ` [${x.status}]` : ''}`).join(', ');
      const mu = l.matchup ? ` vs ${l.matchup.opponent} (win ${Math.round(l.matchup.winProb * 100)}%)` : '';
      console.log(`    - ${l.name} [${l.format}]: ${l.status}${mu}${w ? ` — ⚠ ${w}` : ''}`);
    }

    // Format awareness: same player, different scoring -> different points.
    const std = (await j(await fetch(`${base}/api/leagues/64097/lineup`, authed))).body; // standard
    const tep = (await j(await fetch(`${base}/api/leagues/19622/lineup`, authed))).body; // PPR + TE premium
    const kStd = std.players.find((p) => p.id === '12171');
    const kTep = tep.players.find((p) => p.id === '12171');
    assert(kTep.median > kStd.median, 'TE premium + PPR raises Kelce vs standard');
    console.log(`✓ format-aware: Kelce ${kStd.median} ("${std.format}") vs ${kTep.median} ("${tep.format}")`);

    // Availability: no OUT/bye/injured player is ever in an optimal lineup, and
    // every player has a sane floor <= median <= ceiling band.
    for (const lg of ['64097', '40750', '19622']) {
      const d = (await j(await fetch(`${base}/api/leagues/${lg}/lineup?mode=auto`, authed))).body;
      const byId = new Map(d.players.map((p) => [p.id, p]));
      const badStarter = d.optimal.starterIds.find((id) => !byId.get(id).availability.startable);
      assert(!badStarter, `no unavailable player starts in optimal (${d.name})`);
      assert(d.players.every((p) => p.floor <= p.median && p.median <= p.ceiling), `floor<=median<=ceiling (${d.name})`);
      if (d.matchup) assert(d.matchup.winProb >= 0 && d.matchup.winProb <= 1, 'win prob in [0,1]');
    }
    const sf = (await j(await fetch(`${base}/api/leagues/40750/lineup?mode=auto`, authed))).body;
    assert(sf.warnings.some((w) => w.status === 'OUT'), 'Superflex flags its OUT starter');
    assert(!sf.optimal.starterIds.includes('15859'), 'optimal benches the OUT player (Harrison)');
    console.log(`✓ availability: optimal lineups never start OUT/bye players; ${sf.name} benches its OUT starter`);

    // Modes: safe maximizes floor, aggressive maximizes ceiling.
    const bal = (await j(await fetch(`${base}/api/leagues/40750/lineup?mode=balanced`, authed))).body;
    const safe = (await j(await fetch(`${base}/api/leagues/40750/lineup?mode=safe`, authed))).body;
    const agg = (await j(await fetch(`${base}/api/leagues/40750/lineup?mode=aggressive`, authed))).body;
    assert(safe.optimal.floor >= bal.optimal.floor, 'safe mode maximizes floor');
    assert(agg.optimal.ceiling >= bal.optimal.ceiling, 'aggressive mode maximizes ceiling');
    console.log(
      `✓ modes: safe floor ${safe.optimal.floor} >= balanced ${bal.optimal.floor}; ` +
        `aggressive ceiling ${agg.optimal.ceiling} >= balanced ${bal.optimal.ceiling}`
    );

    // Plan: a diff preview of "Set All", writing nothing.
    r = await j(await fetch(`${base}/api/lineups/plan?mode=auto`, authed));
    assert(r.status === 200 && r.body.summary.leaguesWithChanges >= 1, 'plan has changes to review');
    const changed = r.body.leagues.filter((l) => l.changed);
    assert(changed.every((l) => Array.isArray(l.adds) && Array.isArray(l.drops)), 'plan items carry adds/drops');
    console.log(`✓ Set-All preview (no writes): ${r.body.summary.leaguesWithChanges} leagues would change`);
    for (const l of changed) {
      console.log(
        `    - ${l.name}: +${l.gained} pts · IN ${l.adds.map((p) => p.name).join(', ') || '—'} · ` +
          `OUT ${l.drops.map((p) => p.name).join(', ') || '—'}`
      );
    }

    // THE HEADLINE: set all lineups in one call.
    r = await j(
      await fetch(`${base}/api/lineups/apply`, {
        method: 'POST',
        headers: { ...authed.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'auto' }),
      })
    );
    assert(r.status === 200 && r.body.summary.leaguesUpdated >= 1, 'apply-all updated leagues');
    assert(r.body.summary.pointsGained > 0, 'apply-all gained points');
    console.log(`✓ SET ALL LINEUPS: ${r.body.summary.leaguesUpdated} updated, +${r.body.summary.pointsGained} pts`);

    // After applying: no risk remains (never starting unavailable players); any
    // league still flagged is 'incomplete' (a bye left a slot with no healthy option).
    r = await j(await fetch(`${base}/api/lineups?mode=auto`, authed));
    assert(r.body.summary.risky === 0, 'no risky lineups after set-all');
    assert(
      r.body.leagues.every((l) => l.status === 'optimal' || l.status === 'incomplete'),
      'remaining flags are only unfillable (bye) slots'
    );
    console.log(
      `✓ after set-all: 0 risky; ${r.body.leagues.filter((l) => l.status === 'incomplete').length} ` +
        `league(s) need a waiver pickup (bye-week hole)`
    );

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
