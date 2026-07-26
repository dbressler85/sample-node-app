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
  mflRepo.calendar = async () => []; // no calendar draft event by default (cases below override it)

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
  assert(d.currentPick == null, 'a scheduled (not-yet-live) draft has no current pick on the clock');
  assert(d.picksMade === 0, 'no picks made');
  console.log('✓ future-start draft: scheduled, not on the clock (grid laid out but not begun)');

  // The reported bug: a KEEPER draft that starts tomorrow, with keeper picks ALREADY on the board
  // (franchise 0001 pre-assigned 1.01). Made picks must NOT flip a future-start draft to
  // "in progress → you're on the clock" — a future start is authoritative even with picks present.
  const keeperGrid = grid.map((g, i) => (i === 0 ? { ...g, player: '14801', comments: '[Keeper.] ' } : { ...g })); // 0001 keeper at 1.01 (MFL tags keepers)
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

  // The AUTHORITATIVE start: MFL's calendar DRAFT_START event (confirmed shape from league 15188:
  // { type:"DRAFT_START", start_time:"<epoch>" }). draftResults has no startTime, so the calendar is
  // what tells us "starts at 11am today" vs "on the clock now". Future DRAFT_START → still scheduled.
  const futureCalSec = Math.floor(Date.now() / 1000) + 2 * 3600;
  mflRepo.calendar = async () => [{ type: 'WAIVER_LOCK', start_time: '1778724000' }, { type: 'DRAFT_START', start_time: String(futureCalSec) }];
  mflRepo.draftResults = async () => [{ unit: 'LEAGUE', draftType: 'SNAKE', draftPick: keeperNoStart }]; // no startTime
  const ovC = await draft.getOverview('ck', 'tk');
  const dC = ovC.drafts.find((x) => x.leagueId === '9001');
  assert(dC.status === 'scheduled', `calendar DRAFT_START in the future → scheduled, got ${dC.status}`);
  assert(dC.myOnClock === false, 'not on the clock before the calendar draft start');
  console.log('✓ calendar DRAFT_START (future): scheduled until the real kickoff time');

  // Once the calendar start passes, the draft is live and 0001 is on the clock at 1.01.
  mflRepo.calendar = async () => [{ type: 'DRAFT_START', start_time: String(Math.floor(Date.now() / 1000) - 600) }];
  const ovL = await draft.getOverview('ck', 'tk');
  const dL = ovL.drafts.find((x) => x.leagueId === '9001');
  assert(dL.status === 'in_progress', `calendar DRAFT_START in the past → in progress, got ${dL.status}`);
  assert(dL.myOnClock === true, 'once the calendar start passes, 0001 is on the clock at 1.01');
  console.log('✓ calendar DRAFT_START (past): live, on the clock at the scheduled time');
  mflRepo.calendar = async () => []; // reset for the remaining cases

  // Same grid but a PAST start + a made pick → genuinely in progress, and 0001 (1.01 unmade) is up.
  const past = Math.floor(Date.now() / 1000) - 3600;
  const started = grid.map((g, i) => (i === 0 ? { ...g } : g)); // still no players => on the clock at 1.01
  mflRepo.draftResults = async () => [{ unit: 'LEAGUE', startTime: String(past), draftType: 'SNAKE', draftPick: started }];
  const ov2 = await draft.getOverview('ck', 'tk');
  const d2 = ov2.drafts.find((x) => x.leagueId === '9001');
  assert(d2.status === 'in_progress', `a past-start draft with open slots is in progress, got ${d2.status}`);
  assert(d2.myOnClock === true, 'once started, franchise 0001 is on the clock at 1.01');
  console.log('✓ past-start draft: in progress, on the clock');

  // BUG (Home only shows scheduled drafts): a live draft — a REAL pick already made — whose calendar
  // DRAFT_START is still in the FUTURE (nominal time, or opened early) must read in_progress, NOT be
  // dragged back to scheduled (which mislabeled and hid in-progress drafts on Home).
  const startedEarly = grid.map((g, i) => (i === 0 ? { ...g, player: '15001' } : { ...g }));
  mflRepo.calendar = async () => [{ type: 'DRAFT_START', start_time: String(Math.floor(Date.now() / 1000) + 2 * 3600) }];
  mflRepo.draftResults = async () => [{ unit: 'LEAGUE', draftType: 'SNAKE', draftPick: startedEarly }];
  const ovE = await draft.getOverview('ck', 'tk');
  const dE = ovE.drafts.find((x) => x.leagueId === '9001');
  assert(dE.status === 'in_progress', `a real pick overrides a future nominal start → in_progress, got ${dE.status}`);
  console.log('✓ real pick overrides a future calendar start → in_progress (not hidden from Home)');

  // BUG (watchlist highlights free agents during a pending/ongoing draft): freeAgencyOpen must consult
  // the calendar. A FUTURE DRAFT_START closes FA even when MFL hasn't laid out the grid yet (empty
  // draftResults); a league with no draft on file at all is an established in-season league → FA open.
  const L = { leagueId: '9001', name: 'DataForce', host: 'www49.myfantasyleague.com', franchiseId: '0001' };
  mflRepo.draftResults = async () => []; // grid not laid out
  mflRepo.calendar = async () => [{ type: 'DRAFT_START', start_time: String(Math.floor(Date.now() / 1000) + 3600) }];
  assert((await draft.freeAgencyOpen('ck-fa1', 'tk', L)) === false, 'a future draft (empty grid) closes FA');
  mflRepo.calendar = async () => [];
  assert((await draft.freeAgencyOpen('ck-fa2', 'tk', L)) === true, 'no draft on file → established league → FA open');
  console.log('✓ freeAgencyOpen: future draft closes FA even without a grid; no-draft league stays open');

  // Device-origin (docs/DEVICE_ORIGIN_MFL.md): when the app supplies the per-league draftResults+calendar
  // it fetched straight from MFL on-device, the overview is parsed with ZERO backend draftResults/calendar
  // reads — the fan-out has left the shared IP — and the status/order logic is identical.
  let backendReads = 0;
  const liveGrid = grid.map((g, i) => (i === 0 ? { ...g } : g)); // 1.01 open → 0001 on the clock
  const draftUnits = [{ unit: 'LEAGUE', draftType: 'SNAKE', draftPick: liveGrid }];
  const calEvents = [{ type: 'DRAFT_START', start_time: String(Math.floor(Date.now() / 1000) - 600) }]; // started
  mflRepo.draftResults = async () => { backendReads += 1; return draftUnits; };
  mflRepo.calendar = async () => { backendReads += 1; return calEvents; };
  const before = backendReads;
  const ovD = await draft.getOverview('ck', 'tk', { deviceReads: { 9001: { draftResults: draftUnits, calendar: calEvents } } });
  const dD = ovD.drafts.find((x) => x.leagueId === '9001');
  assert(backendReads === before, `device path issues NO backend draftResults/calendar read, got ${backendReads - before} extra`);
  assert(dD.status === 'in_progress' && dD.myOnClock === true, `device-supplied reads parse identically (in_progress, on the clock), got ${dD.status}/${dD.myOnClock}`);
  const dB = (await draft.getOverview('ck', 'tk')).drafts.find((x) => x.leagueId === '9001');
  assert(dB.status === dD.status && dB.myOnClock === dD.myOnClock, 'device and backend overview agree for the same reads');
  // A league missing from a supplied device map reads as 'none', never a surprise backend read.
  const mark = backendReads;
  const ovM = await draft.getOverview('ck', 'tk', { deviceReads: {} });
  assert(backendReads === mark, 'device mode with a missing league still issues no backend read');
  assert(ovM.drafts.find((x) => x.leagueId === '9001').status === 'none', 'a league missing from the device map reads as none');
  console.log('✓ device-origin: app-supplied draftResults+calendar → identical overview, zero backend reads');

  console.log('\nDRAFT SCHEDULED HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
