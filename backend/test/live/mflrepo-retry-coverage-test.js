'use strict';
// Every per-league fan-out reader in lib/mflRepo retries a transient MFL throttle AT THE SOURCE, so a
// single 429 in a concurrent burst can't spuriously drop a league across the screens each read backs
// (scoreboard, Standings, Free Agents, draft board, trade inbox, waiver windows, trophy scan, …). This
// is the generalization of the draftResults fix: the whole class is hardened in one place. A persistent
// failure must STILL throw so callers surface honest partial/error state rather than a fabricated empty.
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const LEAGUE = { leagueId: 'L1', host: 'www10.myfantasyleague.com' };

// Each reader called (league, cookie) — the throttle-recovery contract is identical regardless of the
// envelope, so an empty {} success body (every parser is null-safe → []) is enough to prove the retry.
const READERS = [
  'rosters', 'playoffBrackets', 'liveScoring', 'draftResults', 'schedule', 'transactions',
  'pendingWaivers', 'assets', 'standings', 'leagueFranchises', 'pendingTrades', 'freeAgentUnits',
  'playerScores', 'projectedScores', 'calendar', 'tradeBaits',
];

(async () => {
  // Transient: throws once (a 429), succeeds on retry → the reader recovers instead of dropping the league.
  for (const name of READERS) {
    let calls = 0;
    mfl.exportRequest = async () => { calls += 1; if (calls === 1) throw new Error('MFL request failed (429)'); return {}; };
    await mflRepo[name](LEAGUE, 'ck');
    assert(calls === 2, `mflRepo.${name} retried the transient throttle (expected 2 calls, got ${calls})`);
  }
  console.log(`✓ all ${READERS.length} per-league fan-out readers retry a transient throttle at the source`);

  // Persistent: still throws after exhausting retries, so the caller can surface an honest partial/error.
  for (const name of READERS) {
    mfl.exportRequest = async () => { throw new Error('MFL request failed (403)'); };
    let threw = false;
    try { await mflRepo[name](LEAGUE, 'ck'); } catch (e) { threw = /403/.test(e.message); }
    assert(threw, `mflRepo.${name} still throws on a persistent failure (caller handles the partial)`);
  }
  console.log(`✓ all ${READERS.length} readers still throw on a persistent failure (callers keep honest partial state)`);

  console.log('\nMFLREPO RETRY COVERAGE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
