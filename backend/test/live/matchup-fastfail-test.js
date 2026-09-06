'use strict';

// The single-league matchup card (GET /leagues/:id/matchup → scoreboard.getLeagueMatchup) is a FOREGROUND
// read. When MFL is throttling/503-ing it must FAIL FAST — a bounded 1-retry ladder so it throws in ~1s
// instead of hanging ~5–12s on the full ladder. It THROWS (does not degrade to null): the client keeps the
// last-known card from cache (non-destructive errors, C4), and a null return stays reserved for a clean
// "nothing live" read. The Sunday scoreboard fan-out keeps the full retries. This pins the fast-fail opts
// threaded to liveScoring AND that a failed read throws (never a false-empty card).

process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mflRepo = require('../../src/lib/mflRepo');
const leaguesService = require('../../src/services/leagues');

leaguesService.listLeagues = async () => [{ leagueId: '1000', host: 'www10.myfantasyleague.com', franchiseId: '0001', name: 'Test League' }];

let captured = null;
mflRepo.liveScoring = async (league, cookie, params = {}, opts = {}) => {
  captured = opts; // record how the matchup path called us
  const e = new Error('MFL request failed (503) for liveScoring');
  e.mflError = '503';
  throw e; // simulate MFL throttling the heavy live read
};

const scoreboard = require('../../src/services/scoreboard');

(async () => {
  // A throttled live read must THROW (so the client keeps its last-known card via C4), not resolve to a
  // false-empty card — but it must throw FAST, having asked liveScoring for the bounded retry budget.
  let threw = null;
  try {
    await scoreboard.getLeagueMatchup('ck', '1000');
  } catch (e) {
    threw = e;
  }
  assert(threw, 'a failed live read throws (never a false-empty card the client would treat as "no game")');
  assert(captured && captured.retries === 1 && captured.maxRetries === 1, `matchup reads live with fast-fail opts, got ${JSON.stringify(captured)}`);
  console.log('✓ matchup: fails FAST (retries:1, maxRetries:1) by throwing — client keeps the last-known card (C4)');

  // A SUCCESSFUL read with no matchup for me still returns a clean empty card (null game) — the "failed vs
  // empty" distinction is preserved.
  mflRepo.liveScoring = async () => []; // read ok, but no franchises → nothing live
  const empty = await scoreboard.getLeagueMatchup('ck', '1000');
  assert(empty && empty.game === null && empty.week === 3, `a clean "nothing live" read → game:null, got ${JSON.stringify(empty)}`);
  console.log('✓ matchup: a successful "nothing live" read still returns a clean empty card (game:null)');

  console.log('\nMATCHUP FAST-FAIL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
