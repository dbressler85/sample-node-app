'use strict';
// lib/mflRepo.rosters retries a transient MFL throttle AT THE SOURCE. This is the shared per-league
// read behind lineups / waivers / the Players+exposure sets / trades / portfolio / On Deck's IR check,
// so a single 429 in a burst used to surface as a spurious "couldn't load" / dropped league across
// those screens. Retrying here hardens every caller at once; a persistent failure still throws so
// callers can surface honest partial state (the loaded-vs-total flags), never a fabricated complete.
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const LEAGUE = { leagueId: 'L1', host: 'www10.myfantasyleague.com' };
const ENVELOPE = { rosters: { franchise: [{ id: '0001', player: [{ id: '11' }] }] } };

(async () => {
  // Transient: throws once (a 429), succeeds on retry → the read recovers instead of dropping the league.
  let calls = 0;
  mfl.exportRequest = async () => { calls += 1; if (calls === 1) throw new Error('MFL request failed (429)'); return ENVELOPE; };
  const franchises = await mflRepo.rosters(LEAGUE, 'ck');
  assert(calls === 2, `rosters retried the transient throttle (expected 2 calls, got ${calls})`);
  assert(franchises.length === 1 && franchises[0].id === '0001', `rosters returned the parsed franchises after retry, got ${JSON.stringify(franchises)}`);
  console.log(`✓ mflRepo.rosters retried a transient throttle and returned the roster (${calls} calls)`);

  // Persistent: still throws after exhausting retries, so the caller shows an honest partial/error
  // rather than a fabricated empty roster.
  mfl.exportRequest = async () => { throw new Error('MFL request failed (403)'); };
  let threw = false;
  try { await mflRepo.rosters(LEAGUE, 'ck'); } catch (e) { threw = /403/.test(e.message); }
  assert(threw, 'a persistent throttle still throws after exhausting retries');
  console.log('✓ mflRepo.rosters still throws on a persistent failure (callers handle the partial)');

  console.log('\nMFLREPO ROSTERS RETRY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
