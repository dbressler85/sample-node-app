'use strict';
// Device-origin cookie handoff (docs/DEVICE_ORIGIN_MFL.md): GET /api/session/mfl-cookie hands the
// AUTHENTICATED device its own MFL session cookie so the app can read straight from MFL. It must be
// (a) OFF by default — 404 until we deliberately enable it — (b) auth-gated so it only ever returns the
// cookie to the session's own owner, and (c) when enabled + authed, return that session's cookie. The
// endpoint reads config.deviceReadsEnabled live per request, so we flip it in-process to cover both.
process.env.MFL_DEMO_MODE = 'true';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const config = require('../../src/config');
  const app = require('../../src/app');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const lr = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'u', password: 'p' }),
    });
    const { token } = await lr.json();
    assert(token, 'login returned an app token');
    const auth = { Authorization: `Bearer ${token}` };

    // (a) OFF by default → 404 even for an authenticated caller.
    config.deviceReadsEnabled = false;
    let r = await fetch(`${base}/api/session/mfl-cookie`, { headers: auth });
    assert(r.status === 404, `disabled → 404, got ${r.status}`);

    // (b) Auth-gated: unauthenticated → 401 even with the flag on.
    config.deviceReadsEnabled = true;
    r = await fetch(`${base}/api/session/mfl-cookie`);
    assert(r.status === 401, `no auth → 401, got ${r.status}`);

    // (c) Enabled + authenticated → 200 with THIS session's cookie (+ host/season for building reads).
    r = await fetch(`${base}/api/session/mfl-cookie`, { headers: auth });
    assert(r.status === 200, `enabled + authed → 200, got ${r.status}`);
    const body = await r.json();
    assert(body.cookie === 'demo-cookie', `returns the session cookie, got ${JSON.stringify(body)}`);
    assert(body.host && body.season, 'includes host + season so the device can build targeted reads');
    console.log('✓ /api/session/mfl-cookie: 404 when off · 401 unauthenticated · 200 with the session cookie when on');
  } finally {
    server.close();
  }
  console.log('\nDEVICE COOKIE HANDOFF HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
