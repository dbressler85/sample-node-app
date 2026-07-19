'use strict';
// Stubbed LIVE-mode harness: prove resolveMatchupLive fields the opponent's
// OPTIMAL lineup from the shared projection map. No real MFL calls.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

// Canned MFL export responses.
const PLAYERS = [
  { id: '1', name: 'Me QB', position: 'QB', team: 'KCC' },
  { id: '2', name: 'Me RB', position: 'RB', team: 'SFO' },
  { id: '3', name: 'Me WR', position: 'WR', team: 'MIA' },
  { id: '4', name: 'Me TE', position: 'TE', team: 'BAL' },
  { id: '10', name: 'Opp QB', position: 'QB', team: 'BUF' },
  { id: '11', name: 'Opp RB1', position: 'RB', team: 'DAL' },
  { id: '12', name: 'Opp WR', position: 'WR', team: 'CIN' },
  { id: '13', name: 'Opp TE', position: 'TE', team: 'KCC' },
  { id: '14', name: 'Opp RB2 (bench, better)', position: 'RB', team: 'GBP' },
];
const SCORES = { '1': 20, '2': 15, '3': 12, '4': 8, '10': 22, '11': 14, '12': 10, '13': 9, '14': 16 };
const ALL_TEAMS = [...new Set(PLAYERS.map((p) => p.team))];

// Toggle: when true, the opponent has SET their lineup (starter RB1=14, bench
// RB2=16 NOT started). When false, no lineup set -> we assume their optimal.
let OPP_HAS_SET_LINEUP = true;

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Test Dynasty', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'rosters': {
      const fid = opts.FRANCHISE;
      if (fid === '0002') {
        // Opponent: RB1 (11) started, better RB2 (14->id 14, score 16) benched.
        const starterFlag = (id) => (OPP_HAS_SET_LINEUP && ['10', '11', '12', '13'].includes(id) ? 'starter' : 'nonstarter');
        return { rosters: { franchise: [{ id: fid, player: ['10', '11', '12', '13', '14'].map((id) => ({ id, status: starterFlag(id) })) }] } };
      }
      return { rosters: { franchise: [{ id: fid || '0001', player: ['1', '2', '3', '4'].map((id) => ({ id, status: 'starter' })) }] } };
    }
    case 'league':
      return { league: { starters: { position: [
        { name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }, { name: 'TE', limit: '1' },
      ] }, franchises: { franchise: [ { id: '0001', name: 'My Team' }, { id: '0002', name: 'Rival Squad' } ] } } };
    case 'projectedScores':
      return { projectedScores: { playerScore: Object.entries(SCORES).map(([id, score]) => ({ id, score: String(score) })) } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'nflSchedule':
      return { nflSchedule: { matchup: ALL_TEAMS.map((t) => ({ team: [{ id: t }] })) } };
    case 'schedule':
      return { schedule: { weeklySchedule: [{ week: '3', matchup: [{ franchise: [{ id: '0001' }, { id: '0002' }] }] }] } };
    default:
      return {};
  }
};

const lineups = require('../../src/services/lineups');

const assert = (c, msg) => { if (!c) throw new Error('FAIL: ' + msg); };

// Force a fresh view each time (bypass the 60s read cache between cases).
function freshView() {
  const cfg = require('../../src/config');
  return lineups.getLineup('fake-cookie', 'fake-token', '1000', 'balanced');
}

(async () => {
  // CASE 1: opponent HAS set their lineup -> project their submitted starters.
  // Submitted: QB22 + RB1 14 (they left the better RB on the bench) + WR10 + TE9 = 55.
  OPP_HAS_SET_LINEUP = true;
  let m = (await freshView()).matchup;
  console.log('CASE 1 (lineup set):', JSON.stringify(m));
  assert(m && m.opponent === 'Rival Squad', 'opponent name resolved');
  assert(m.basis === 'submitted', `basis submitted, got ${m.basis}`);
  assert(m.opponentProjected === 55, `submitted starters = 55 (kept RB 14, not bench 16), got ${m.opponentProjected}`);
  console.log(`✓ submitted: uses their actual starters (RB 14 kept over bench 16) -> ${m.opponentProjected}`);

  // Bust the short-lived read cache so CASE 2 re-fetches with the new flag.
  const mflLib = require('../../src/lib/mfl');
  // exportRequest is our stub (no cache), but lineups caches nothing itself; the
  // 60s cache lives in the real exportRequest we replaced, so nothing to clear.

  // CASE 2: opponent has NOT set a lineup -> assume their optimal (best case).
  // Optimal: QB22 + best RB 16 (bench) + WR10 + TE9 = 57.
  OPP_HAS_SET_LINEUP = false;
  m = (await freshView()).matchup;
  console.log('CASE 2 (lineup unset):', JSON.stringify(m));
  assert(m.basis === 'projected', `basis projected, got ${m.basis}`);
  assert(m.opponentProjected === 57, `optimal = 57 (assumes bench RB 16), got ${m.opponentProjected}`);
  console.log(`✓ unset: assumes their best lineup (bench RB 16) -> ${m.opponentProjected}`);

  console.log('\nLIVE MATCHUP HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
