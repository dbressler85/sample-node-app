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

  // The reported bug: a KEEPER draft that starts tomorrow, with keeper picks ALREADY on the board
  // (franchise 0001 pre-assigned 1.01). Made picks must NOT flip a future-start draft to
  // "in progress → you're on the clock" — a future start is authoritative even with picks present.
  const keeperGrid = grid.map((g, i) => (i === 0 ? { ...g, player: '14801' } : { ...g })); // 0001 keeper at 1.01
  mflRepo.draftResults = async () => [{ unit: 'LEAGUE', startTime: String(future), draftType: 'SNAKE', draftPick: keeperGrid }];
  const ovK = await draft.getOverview('ck', 'tk');
  const dK = ovK.drafts.find((x) => x.leagueId === '9001');
  assert(dK.status === 'scheduled', `a future-start keeper draft (picks pre-loaded) still reads scheduled, got ${dK.status}`);
  assert(dK.myOnClock === false, 'I am NOT on the clock before a keeper draft starts, even with keepers on the board');
  console.log('✓ future-start KEEPER draft: pre-loaded picks do not put you on the clock');

  // The DataForce bug (league 15188): a keeper league with NO startTime exposed, whose LATE rounds are
  // pre-filled with KEEPER picks (real player id + one bulk "lock" timestamp + a "[Keeper.]" comment)
  // while the early draftable rounds are empty. Keepers are NOT draft activity — this must read
  // scheduled (not "in progress → on the clock → overdue"), even though the grid has players in it and
  // the keeper timestamp is days old (which was becoming a stale pick-clock anchor → "Overdue").
  const lockTs = String(Math.floor(Date.now() / 1000) - 2 * 24 * 3600); // keepers locked ~2 days ago
  const keeperNoStart = [];
  for (let r = 1; r <= 2; r++) for (let f = 1; f <= 3; f++) keeperNoStart.push({ round: String(r), pick: String(f), franchise: `000${f}`, player: '', comments: '', timestamp: '' });
  for (let r = 3; r <= 4; r++) for (let f = 1; f <= 3; f++) keeperNoStart.push({ round: String(r), pick: String(f), franchise: `000${f}`, player: `160${r}${f}`, comments: '[Keeper.] ', timestamp: lockTs });
  mflRepo.draftResults = async () => [{ unit: 'LEAGUE', draftType: 'SNAKE', draftPick: keeperNoStart }]; // NO startTime
  const ovN = await draft.getOverview('ck', 'tk');
  const dN = ovN.drafts.find((x) => x.leagueId === '9001');
  assert(dN.status === 'scheduled', `keeper grid, no startTime → scheduled, got ${dN.status}`);
  assert(dN.myOnClock === false, 'keepers on the board (no real picks) do NOT put me on the clock');
  assert(dN.picksMade === 0, `keepers are not counted as picks made, got ${dN.picksMade}`);
  console.log('✓ keeper draft, no startTime: scheduled — keepers are not draft activity (DataForce 15188 bug)');

  // And once a REAL (non-keeper) pick is actually made in round 1, it IS in progress — keepers still
  // excluded from the count.
  const keeperPlusReal = keeperNoStart.map((g) => ({ ...g }));
  keeperPlusReal[0] = { ...keeperPlusReal[0], player: '15000', comments: '', timestamp: String(Math.floor(Date.now() / 1000) - 600) };
  mflRepo.draftResults = async () => [{ unit: 'LEAGUE', draftType: 'SNAKE', draftPick: keeperPlusReal }];
  const ovR = await draft.getOverview('ck', 'tk');
  const dR = ovR.drafts.find((x) => x.leagueId === '9001');
  assert(dR.status === 'in_progress', `a real pick starts the draft, got ${dR.status}`);
  assert(dR.picksMade === 1, `only the real pick counts, not the keepers, got ${dR.picksMade}`);
  console.log('✓ keeper draft + one real pick: in progress, keepers still excluded from the count');

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
