'use strict';
// Cross-user shared cache: league-global MFL reads (rosters, free agents, live scoring, …) are the
// SAME for every member of a league, so two DIFFERENT user sessions reading the same league must hit
// ONE underlying MFL fetch, not two — this is what stops the app's single API budget from scaling
// with the number of users on a busy Sunday. User-specific reads (myleagues) stay private (one fetch
// per session), and a write invalidates the SHARED copy so the next read refetches.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// Count outbound HTTP calls by export TYPE (+ league), so we can prove sharing vs. per-user.
const calls = [];
global.fetch = async (url) => {
  calls.push(String(url));
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{}' };
};
const countType = (type) => calls.filter((u) => u.includes(`TYPE=${type}`)).length;

const mfl = require('../../src/lib/mfl');
const HOST = 'www10.myfantasyleague.com';

(async () => {
  // Two different sessions (A and B) — both members of league L1 — read the same league-global export.
  await mfl.exportRequest('rosters', { host: HOST, cookie: 'cookieA', L: 'L1' });
  await mfl.exportRequest('rosters', { host: HOST, cookie: 'cookieB', L: 'L1' });
  assert(countType('rosters') === 1, `two sessions reading L1 rosters share ONE fetch, got ${countType('rosters')}`);
  console.log('✓ league-global read (rosters) is shared across sessions: 1 fetch for 2 users');

  // A third session reading a DIFFERENT league still fetches (different key), so sharing is per-league.
  await mfl.exportRequest('rosters', { host: HOST, cookie: 'cookieC', L: 'L2' });
  assert(countType('rosters') === 2, `a different league (L2) is a separate fetch, got ${countType('rosters')}`);
  console.log('✓ sharing is per-league: L2 is its own fetch');

  // User-specific read (myleagues) must NOT be shared — each session gets its own.
  await mfl.exportRequest('myleagues', { host: HOST, cookie: 'cookieA' });
  await mfl.exportRequest('myleagues', { host: HOST, cookie: 'cookieB' });
  assert(countType('myleagues') === 2, `myleagues stays private per session, got ${countType('myleagues')}`);
  console.log('✓ user-specific read (myleagues) stays private: 2 fetches for 2 users');

  // pendingWaivers is caller-scoped too — private per session.
  await mfl.exportRequest('pendingWaivers', { host: HOST, cookie: 'cookieA', L: 'L1' });
  await mfl.exportRequest('pendingWaivers', { host: HOST, cookie: 'cookieB', L: 'L1' });
  assert(countType('pendingWaivers') === 2, `pendingWaivers stays private per session, got ${countType('pendingWaivers')}`);
  console.log('✓ caller-scoped read (pendingWaivers) stays private: 2 fetches');

  // A write to L1 (by A) invalidates the SHARED roster copy, so B's next read refetches fresh.
  mfl.invalidateLeague('cookieA', 'L1');
  await mfl.exportRequest('rosters', { host: HOST, cookie: 'cookieB', L: 'L1' });
  assert(countType('rosters') === 3, `after a write, the shared L1 roster refetches, got ${countType('rosters')} total`);
  console.log('✓ a write clears the SHARED copy so the next read is fresh');

  console.log('\nSHARED CACHE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
