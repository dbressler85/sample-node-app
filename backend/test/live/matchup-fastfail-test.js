'use strict';

// The single-league matchup card (GET /leagues/:id/matchup → scoreboard.getLeagueMatchup) is a FOREGROUND
// read. When MFL is throttling/503-ing it must FAIL FAST — a bounded 1-retry ladder — and DEGRADE to an
// empty card (game:null, HTTP 200), never hang ~5–12s on the full retry ladder and 502 the screen. The
// Sunday scoreboard fan-out keeps the full retries (a real drop still throws → honest `partial`). This
// pins the fast-fail opts threaded to liveScoring AND the degrade-to-null on failure.

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
  const out = await scoreboard.getLeagueMatchup('ck', '1000');
  // Degrades to an empty card — a 200 with game:null — rather than propagating a 502.
  assert(out && out.game === null, `matchup degrades to game:null on a failed live read, got ${JSON.stringify(out)}`);
  assert(out.week === 3, `week still resolves, got ${out.week}`);
  // And it asked liveScoring to fail fast: one source retry, one 503 retry.
  assert(captured && captured.retries === 1 && captured.maxRetries === 1, `matchup reads live with fast-fail opts, got ${JSON.stringify(captured)}`);
  console.log('✓ matchup: fails fast (retries:1, maxRetries:1) and degrades to an empty card, not a 502');

  console.log('\nMATCHUP FAST-FAIL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
