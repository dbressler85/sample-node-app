'use strict';
// Per-IP API rate limit (roadmap #4): a GENEROUS abuse backstop. Over the ceiling → 429; the health
// probe is exempt; normal responses carry RateLimit-* headers. We set a tiny ceiling via env so the
// test is fast — production's default is deliberately large.
process.env.MFL_DEMO_MODE = 'true';
process.env.RATE_LIMIT_MAX = '3';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const app = require('../../src/app');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // /api/health is declared BEFORE the limiter, so probes are never throttled.
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/api/health`);
      assert(r.status === 200, `health probe not rate-limited (request ${i + 1})`);
    }
    console.log('✓ /api/health is exempt from the limiter (probes never 429)');

    // A limited path: the first `max` requests pass the limiter (reach the router → 401 without auth),
    // then the next is refused with 429.
    const codes = [];
    let last;
    for (let i = 0; i < 4; i++) {
      last = await fetch(`${base}/api/me`);
      codes.push(last.status);
    }
    assert(codes.slice(0, 3).every((c) => c === 401), `first 3 pass the limiter (401 unauth), got ${codes}`);
    assert(codes[3] === 429, `the 4th (over-limit) request is 429, got ${codes[3]}`);
    assert(last.headers.has('ratelimit-limit') || last.headers.has('ratelimit'), 'RateLimit-* headers present');
    console.log(`✓ over the ceiling → 429 (codes ${codes.join(',')}); RateLimit headers present`);

    console.log('\nRATE LIMIT HARNESS PASSED');
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
