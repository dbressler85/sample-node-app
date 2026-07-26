'use strict';
// POST /api/players/lookup — the GLOBAL player dictionary (name/pos/team/value) for a set of ids, the
// backend-cached half of a device-origin roster read (docs/DEVICE_ORIGIN_MFL.md). The device fetches a
// league's rosters straight from MFL and calls this to enrich the ids it got, so the per-user fan-out
// leaves the server while shared player/value data stays cached here. Auth-gated; returns a subset.
process.env.MFL_DEMO_MODE = 'true';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const app = require('../../src/app');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lr = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'u', password: 'p' }),
    });
    const { token } = await lr.json();
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Auth-gated.
    const un = await fetch(`${base}/api/players/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['1'] }) });
    assert(un.status === 401, `lookup requires auth, got ${un.status}`);

    // Returns an entry (name/position/team/value keys) for every requested id, deduped.
    const r = await fetch(`${base}/api/players/lookup`, { method: 'POST', headers: auth, body: JSON.stringify({ ids: ['1', '2', '2'] }) });
    assert(r.status === 200, `authed lookup → 200, got ${r.status}`);
    const body = await r.json();
    assert(body.players && typeof body.players === 'object', 'response has a players dictionary');
    for (const id of ['1', '2']) {
      const p = body.players[id];
      assert(p && 'name' in p && 'position' in p && 'team' in p && 'value' in p, `id ${id} has name/position/team/value`);
    }
    console.log('✓ /api/players/lookup: auth-gated; returns name/position/team/value per id');

    // Draft-pick tokens (FP_/DP_) resolve to a readable pick label with position PICK — so a
    // device-origin transactions read can enrich traded picks through the same lookup as players.
    const pk = await fetch(`${base}/api/players/lookup`, { method: 'POST', headers: auth, body: JSON.stringify({ ids: ['FP_0005_2027_1'] }) });
    const pb = await pk.json();
    const pick = pb.players && pb.players['FP_0005_2027_1'];
    assert(pick && pick.position === 'PICK' && pick.name && pick.name !== 'FP_0005_2027_1', `pick token → { position:'PICK', readable name }, got ${JSON.stringify(pick)}`);
    console.log('✓ /api/players/lookup: draft-pick tokens resolve to a pick label (position PICK)');

    // Empty / non-array ids → empty dictionary, never an error.
    const empty = await fetch(`${base}/api/players/lookup`, { method: 'POST', headers: auth, body: JSON.stringify({}) });
    const eb = await empty.json();
    assert(empty.status === 200 && eb.players && Object.keys(eb.players).length === 0, 'no ids → empty dictionary, not an error');
    console.log('✓ /api/players/lookup: empty ids → empty dictionary');

    // Franchise directory (the name half of a device-origin roster render).
    const lg = await (await fetch(`${base}/api/leagues`, { headers: { Authorization: `Bearer ${token}` } })).json();
    const leagueId = lg && lg.leagues && lg.leagues[0] && lg.leagues[0].leagueId;
    assert(leagueId, 'have a demo league to query');
    const fr = await fetch(`${base}/api/leagues/${leagueId}/franchises`, { headers: { Authorization: `Bearer ${token}` } });
    assert(fr.status === 200, `franchises endpoint → 200, got ${fr.status}`);
    const fb = await fr.json();
    assert(fb && typeof fb.franchises === 'object' && 'mine' in fb && 'playoffSpots' in fb, 'franchise directory has { franchises, mine, playoffSpots }');
    console.log('✓ /api/leagues/:id/franchises: returns { franchises, mine, playoffSpots }');

    // Exposure enrichment (the backend half of a device-origin cross-league exposure read): the device
    // fetches MY roster in every league on-device and calls this for the per-player fields it groups —
    // name/pos/team/age/value/availability + season/proj points + tag/watched.
    const exUn = await fetch(`${base}/api/players/exposure-enrich`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['1'] }) });
    assert(exUn.status === 401, `exposure-enrich requires auth, got ${exUn.status}`);
    const ex = await fetch(`${base}/api/players/exposure-enrich`, { method: 'POST', headers: auth, body: JSON.stringify({ ids: ['1', '2', '2'], primaryLeagueId: leagueId }) });
    assert(ex.status === 200, `exposure-enrich → 200, got ${ex.status}`);
    const exb = await ex.json();
    assert(exb.players && typeof exb.players === 'object', 'exposure-enrich returns a players dictionary');
    for (const id of ['1', '2']) {
      const p = exb.players[id];
      assert(p && 'name' in p && 'age' in p && 'value' in p && 'availability' in p && 'seasonPoints' in p && 'weekProjection' in p && 'tag' in p && 'watched' in p, `id ${id} carries the exposure enrichment fields`);
    }
    console.log('✓ /api/players/exposure-enrich: auth-gated; per-id exposure enrichment (age/value/availability/points/tag/watched)');

    // Device-read beacon → /_metrics deviceReads split (the device-origin payoff, measured).
    await fetch(`${base}/api/metrics/device-read`, { method: 'POST', headers: auth, body: JSON.stringify({ read: 'rosters', source: 'device' }) });
    await fetch(`${base}/api/metrics/device-read`, { method: 'POST', headers: auth, body: JSON.stringify({ read: 'rosters', source: 'backend' }) });
    const mx = await (await fetch(`${base}/api/_metrics`)).json();
    const dr = ((mx.mfl && mx.mfl.deviceReads) || []).find((x) => x.read === 'rosters');
    assert(dr && dr.device >= 1 && dr.backend >= 1, `beacon feeds /_metrics deviceReads, got ${JSON.stringify(dr)}`);
    assert(mx.client && mx.client.deviceReadsEnabled === false, 'client.deviceReadsEnabled surfaced on /_metrics');
    console.log('✓ device-read beacon → /_metrics deviceReads split + client.deviceReadsEnabled');
  } finally {
    server.close();
  }
  console.log('\nPLAYER LOOKUP HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
