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

    // Device-read beacon → /_metrics deviceReads (the device-origin payoff, measured). The enriched
    // beacon also carries per-path LATENCY (is device-origin worth it) and, on a fallback, the REASON
    // (when does it break) — so /_metrics answers more than "is it working".
    await fetch(`${base}/api/metrics/device-read`, { method: 'POST', headers: auth, body: JSON.stringify({ read: 'rosters', source: 'device', ms: 120 }) });
    await fetch(`${base}/api/metrics/device-read`, { method: 'POST', headers: auth, body: JSON.stringify({ read: 'rosters', source: 'backend', ms: 300, reason: 'rate_limited' }) });
    const mx = await (await fetch(`${base}/api/_metrics`)).json();
    const dr = ((mx.mfl && mx.mfl.deviceReads) || []).find((x) => x.read === 'rosters');
    assert(dr && dr.device >= 1 && dr.backend >= 1, `beacon feeds /_metrics deviceReads, got ${JSON.stringify(dr)}`);
    assert(dr.deviceAvgMs === 120 && dr.backendAvgMs === 300, `beacon records per-path latency, got ${JSON.stringify({ d: dr.deviceAvgMs, b: dr.backendAvgMs })}`);
    assert(dr.fallbacks >= 1 && dr.reasons && dr.reasons.rate_limited >= 1, `beacon records the fallback reason, got ${JSON.stringify({ f: dr.fallbacks, r: dr.reasons })}`);
    assert(mx.client && mx.client.deviceReadsEnabled === false, 'client.deviceReadsEnabled surfaced on /_metrics');
    // A-4: the beacon's `read` is client-supplied, so an unknown/arbitrary name must NOT mint its own
    // /_metrics key (an authenticated memory-growth vector) — it's bucketed to '(other)'.
    await fetch(`${base}/api/metrics/device-read`, { method: 'POST', headers: auth, body: JSON.stringify({ read: 'x'.repeat(500) + '-bogus', source: 'device', ms: 10 }) });
    const mx2 = await (await fetch(`${base}/api/_metrics`)).json();
    const rows = (mx2.mfl && mx2.mfl.deviceReads) || [];
    assert(!rows.some((x) => /bogus/.test(x.read)), 'an unknown device-read name does not mint its own /_metrics key (A-4)');
    assert(rows.some((x) => x.read === '(other)' && x.device >= 1), 'unknown device-read names are bucketed to (other) (A-4)');
    // A-6: the device reports its shared-core version on the beacon; /_metrics surfaces the distribution +
    // a stale-client tally (a build OLDER than this backend), so silent version skew is observable.
    const backendVer = require('../../src/lib/mflRead').VERSION;
    await fetch(`${base}/api/metrics/device-read`, { method: 'POST', headers: auth, body: JSON.stringify({ read: 'rosters', source: 'device', ms: 5, ver: backendVer }) });
    await fetch(`${base}/api/metrics/device-read`, { method: 'POST', headers: auth, body: JSON.stringify({ read: 'rosters', source: 'device', ms: 5, ver: backendVer - 1 }) }); // stale
    const mp = (await (await fetch(`${base}/api/_metrics`)).json()).mfl.deviceParity;
    assert(mp && mp.backendVersion === backendVer, `deviceParity surfaces the backend version, got ${JSON.stringify(mp)}`);
    assert(mp.versions[String(backendVer)] >= 1 && mp.versions[String(backendVer - 1)] >= 1, `records the reported version distribution, got ${JSON.stringify(mp.versions)}`);
    assert(mp.staleClientReads >= 1, `flags a beacon from an older-than-backend app as stale, got ${mp.staleClientReads}`);
    // U-5: the per-read latency rolls up into a single "is device-origin faster" headline. Every device
    // beacon in this test was ≤120ms and the only backend beacon was 300ms, so the pooled answer must show
    // the device winning (faster by a positive ms + %). (Exact avg floats with the other beacons above.)
    const dl = (await (await fetch(`${base}/api/_metrics`)).json()).mfl.deviceLatency;
    assert(dl && dl.deviceSamples >= 1 && dl.backendSamples >= 1, `rolls up device + backend latency samples, got ${JSON.stringify(dl)}`);
    assert(dl.deviceAvgMs < dl.backendAvgMs && dl.deviceFasterByMs > 0 && dl.deviceFasterPct > 0, `surfaces the device-faster headline, got ${JSON.stringify(dl)}`);
    console.log('✓ beacon → deviceReads split + latency + reasons; unknown names bucketed (A-4); version/stale obs (A-6); device-faster headline (U-5)');
  } finally {
    server.close();
  }
  console.log('\nPLAYER LOOKUP HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
