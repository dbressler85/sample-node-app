'use strict';

// Foreground reads (a GET the user is waiting on) cap their MFL 503 retry ladder so a sustained throttle
// FAILS FAST — the client keeps its last-known content (C4) — instead of hanging on the full ladder and
// 502-ing. Background fan-outs (X-DC-Priority: low), writes, and non-HTTP jobs keep the full retry budget.
// This pins the ambient budget (reqPriority), the middleware wiring, and that rawRequest honors the cap.

process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_FOREGROUND_MAX_RETRIES = '0'; // foreground → no 503 retries (fast, deterministic in the integration case)
process.env.MFL_MAX_RETRIES = '3'; // background/full budget

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const reqPriority = require('../../src/lib/reqPriority');
const priorityMw = require('../../src/middleware/priority');
const config = require('../../src/config');
const mfl = require('../../src/lib/mfl');

(async () => {
  // --- reqPriority ambient budget ----------------------------------------------------------------
  reqPriority.runForeground(2, () => {
    assert(reqPriority.current() === 'normal', 'foreground context stays NORMAL priority (preempts the LOW lane)');
    assert(reqPriority.foregroundMaxRetries() === 2, 'foreground context carries the retry cap');
  });
  reqPriority.runLow(() => {
    assert(reqPriority.current() === 'low', 'low context is LOW priority');
    assert(reqPriority.foregroundMaxRetries() === undefined, 'a low (background) read has no foreground cap → full budget');
  });
  assert(reqPriority.foregroundMaxRetries() === undefined, 'no context (a background job) has no foreground cap → full budget');
  console.log('✓ reqPriority: foreground carries the cap; low + no-context fall through to the full budget');

  // --- middleware wiring --------------------------------------------------------------------------
  const run = (method, header) => new Promise((resolve) => {
    const req = { method, get: (h) => (h.toLowerCase() === 'x-dc-priority' ? header : undefined) };
    priorityMw(req, {}, () => resolve({ priority: reqPriority.current(), cap: reqPriority.foregroundMaxRetries() }));
  });
  const fg = await run('GET', undefined);
  assert(fg.priority === 'normal' && fg.cap === config.mflForegroundMaxRetries, `a foreground GET gets the cap, got ${JSON.stringify(fg)}`);
  const write = await run('POST', undefined);
  assert(write.cap === undefined, 'a write (POST) is NOT capped — it must not give up early');
  const bg = await run('GET', 'low');
  assert(bg.priority === 'low' && bg.cap === undefined, `an X-DC-Priority:low GET stays background with the full budget, got ${JSON.stringify(bg)}`);
  console.log('✓ middleware: foreground GET → capped; POST write → uncapped; low GET → background/full budget');

  // --- rawRequest honors the cap (integration, fast: foreground cap is 0 → exactly one attempt) ----
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return { ok: false, status: 503, headers: { get: () => null }, text: async () => '<html>503</html>' }; };

  // A foreground read (cap 0) makes exactly ONE attempt against a sustained 503 — no retry ladder.
  fetchCalls = 0;
  await reqPriority.runForeground(0, async () => {
    try { await mfl.exportRequest('players', { host: 'www10.myfantasyleague.com' }); } catch (e) { /* expected 503 */ }
  });
  assert(fetchCalls === 1, `foreground (cap 0) makes ONE attempt against a sustained 503, got ${fetchCalls}`);
  console.log('✓ rawRequest: a foreground read fails fast (one attempt), no 503 ladder');

  console.log('\nFOREGROUND RETRY BUDGET HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
