'use strict';

// Player profile — full-season game-by-game schedule with projected + actual points. Past weeks carry
// the ACTUAL score, the current week carries BOTH (a pre-game projection and the live/final actual),
// upcoming weeks carry the PROJECTION, and bye weeks are marked with no opponent and no points.

const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-sched-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const leaguesService = require('../../src/services/leagues');

leaguesService.listLeagues = async () => [{ leagueId: 'SCHED1', name: 'Sched League', host: 'www10.myfantasyleague.com', franchiseId: '0001' }];

const PLAYER = { id: '9', name: 'Test, Player', position: 'WR', team: 'AAA' };
const ACTUAL = { 1: '20.5', 2: '14.0', 3: '25.0' }; // playerScores by week
const PROJ = { 3: '18.0' }; // projectedScores by week (only the current/future weeks get called)
// Full-season schedule (W=ALL): AAA home vs BBB (wk1), @CCC (wk2), home vs DDD (wk3), bye (wk4).
const FULL = { fullNflSchedule: { nflSchedule: [
  { week: '1', matchup: [{ team: [{ id: 'BBB' }, { id: 'AAA' }] }] }, // away first → AAA home
  { week: '2', matchup: [{ team: [{ id: 'AAA' }, { id: 'CCC' }] }] }, // AAA away @ CCC
  { week: '3', matchup: [{ team: [{ id: 'DDD' }, { id: 'AAA' }] }] }, // AAA home vs DDD
  { week: '4', matchup: [{ team: [{ id: 'EEE' }, { id: 'FFF' }] }] }, // AAA on bye
] } };

global.fetch = async () => ({ ok: true, json: async () => [] });
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'players': return { players: { player: [PLAYER] } };
    case 'nflSchedule':
      return String(opts.W) === 'ALL' ? FULL : { nflSchedule: { week: '3', matchup: FULL.fullNflSchedule.nflSchedule[2].matchup } };
    case 'playerScores': { const s = ACTUAL[String(opts.W)]; return { playerScores: { playerScore: s != null ? [{ id: '9', score: s }] : [] } }; }
    case 'projectedScores': { const s = PROJ[String(opts.W)]; return { projectedScores: { playerScore: s != null ? [{ id: '9', score: s }] : [] } }; }
    default: return {};
  }
};

const hub = require('../../src/services/playerhub');

(async () => {
  const r = await hub.gameSchedule('ck', 'tk', '9');
  assert(r.playerId === '9' && r.team === 'AAA', 'carries player id + team');
  assert(r.scoringLeague && r.scoringLeague.id === 'SCHED1', 'names the scoring league');
  assert(r.weeks.length === 4, `one row per scheduled week, got ${r.weeks.length}`);
  const [w1, w2, w3, w4] = r.weeks;

  assert(w1.week === 1 && w1.opp === 'BBB' && w1.home === true, `wk1 home vs BBB, got ${JSON.stringify(w1)}`);
  assert(w1.actual === 20.5 && w1.projected == null, 'wk1 (past) shows ACTUAL only');

  assert(w2.opp === 'CCC' && w2.home === false && w2.actual === 14.0, `wk2 (past) away @CCC actual, got ${JSON.stringify(w2)}`);

  assert(w3.week === 3 && w3.opp === 'DDD', `wk3 opp, got ${JSON.stringify(w3)}`);
  assert(w3.projected === 18.0 && w3.actual === 25.0, 'wk3 (current) shows BOTH projection and live actual');

  assert(w4.bye === true && w4.opp == null && w4.projected == null && w4.actual == null, `wk4 bye row, got ${JSON.stringify(w4)}`);

  console.log('✓ schedule: past→actual, current→proj+actual, future→proj, bye handled');
  console.log('\nPLAYER SCHEDULE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
