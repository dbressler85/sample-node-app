'use strict';
// Regression: a draft whose ORDER grid is fully laid out (incl. traded-pick slots) but that hasn't
// STARTED yet — MFL shows "Draft hasn't started, will start in 18 hours" — must read as `scheduled`,
// NOT "in progress / you're on the clock". A future startTime is authoritative over the grid.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const mflRepo = require('../../src/lib/mflRepo');
  const leaguesService = require('../../src/services/leagues');
  leaguesService.listLeagues = async () => [
    { leagueId: '9001', name: 'DataForce', host: 'www49.myfantasyleague.com', franchiseId: '0001' },
  ];

  const future = Math.floor(Date.now() / 1000) + 18 * 3600; // ~18h out, in seconds (MFL epoch)
  // A full 2-round order for a 3-team league, franchise 0001 owns 1.01 — NO players picked yet.
  const grid = [];
  for (let r = 1; r <= 2; r++) for (let f = 1; f <= 3; f++) grid.push({ round: String(r), pick: String(f), franchise: `000${f}`, player: '' });
  mflRepo.draftResults = async () => [{ unit: 'LEAGUE', startTime: String(future), draftType: 'SNAKE', draftPick: grid }];

  const draft = require('../../src/services/draft');
  const ov = await draft.getOverview('ck', 'tk');
  const d = ov.drafts.find((x) => x.leagueId === '9001');
  assert(d, 'the draft is in the overview');
  assert(d.status === 'scheduled', `an unstarted future draft reads scheduled, got ${d.status}`);
  assert(d.myOnClock === false, 'I am NOT on the clock before the draft starts');
  assert(d.picksMade === 0, 'no picks made');
  console.log('✓ future-start draft: scheduled, not on the clock (grid laid out but not begun)');

  // Same grid but a PAST start + a made pick → genuinely in progress, and 0001 (1.01 unmade) is up.
  const past = Math.floor(Date.now() / 1000) - 3600;
  const started = grid.map((g, i) => (i === 0 ? { ...g } : g)); // still no players => on the clock at 1.01
  mflRepo.draftResults = async () => [{ unit: 'LEAGUE', startTime: String(past), draftType: 'SNAKE', draftPick: started }];
  const ov2 = await draft.getOverview('ck', 'tk');
  const d2 = ov2.drafts.find((x) => x.leagueId === '9001');
  assert(d2.status === 'in_progress', `a past-start draft with open slots is in progress, got ${d2.status}`);
  assert(d2.myOnClock === true, 'once started, franchise 0001 is on the clock at 1.01');
  console.log('✓ past-start draft: in progress, on the clock');

  console.log('\nDRAFT SCHEDULED HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
