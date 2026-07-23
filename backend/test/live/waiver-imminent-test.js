'use strict';
// A league's next waiver RUN comes from its calendar's process events (TYPE=WAIVER_BBID etc.),
// which carry start_time (epoch seconds) + `happens` (a weekly repeat count). A run that lands
// within config.waiverImminentMs (default 3 days) is an act-now item — surfaced on the Waivers
// overview (waiverImminent + summary.imminent) and as a Home triage item. This pins:
//   * L1: a run 2 days out            => imminent
//   * L2: a run 10 days out           => NOT imminent
//   * L3: base start in the PAST but a weekly `happens` occurrence 1 day out => imminent
//   * L4: no process events           => not imminent (and no crash)
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

const nowSec = Math.floor(Date.now() / 1000);
const inDays = (d) => String(nowSec + Math.round(d * 86400));
const agoDays = (d) => String(nowSec - Math.round(d * 86400));

const PLAYERS = [
  { id: '1', name: 'Starter, A', position: 'RB', team: 'AAA' },
  { id: '2', name: 'Bench, B', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free, C', position: 'RB', team: 'CCC' },
];

const CALENDARS = {
  L1: { calendar: { event: [{ type: 'WAIVER_BBID', start_time: inDays(2), happens: '1' }] } },
  L2: { calendar: { event: [{ type: 'WAIVER_BBID', start_time: inDays(10), happens: '1' }] } },
  // Base run was 6 days ago but it repeats weekly, so the next occurrence is 1 day out.
  L3: { calendar: { event: [{ type: 'WAIVER_BBID', start_time: agoDays(6), happens: '10' }] } },
  // Only a lock event (not a process) — no imminent run.
  L4: { calendar: { event: [{ type: 'WAIVER_LOCK', start_time: inDays(1), happens: '1' }] } },
};

const LEAGUES = [
  { league_id: 'L1', name: 'Runs In 2d', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001' },
  { league_id: 'L2', name: 'Runs In 10d', url: 'https://www10.myfantasyleague.com/2026/home/L2', franchise_id: '0001' },
  { league_id: 'L3', name: 'Weekly Next 1d', url: 'https://www10.myfantasyleague.com/2026/home/L3', franchise_id: '0001' },
  { league_id: 'L4', name: 'No Runs', url: 'https://www10.myfantasyleague.com/2026/home/L4', franchise_id: '0001' },
];

mfl.exportRequest = async (type, opts = {}) => {
  const L = opts.L;
  switch (type) {
    case 'myleagues':
      return { leagues: { league: LEAGUES } };
    case 'calendar':
      return CALENDARS[L] || {};
    case 'league':
      return { league: { rosterSize: '20', minBid: '1', franchises: { franchise: [{ id: '0001' }] }, starters: { position: [{ name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] } } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: [{ id: '1', status: 'starter' }, { id: '2', status: 'nonstarter' }] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '50' }] } } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'nflSchedule':
      return { nflSchedule: { week: '3', matchup: [] } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    case 'draftResults':
      return { draftResults: { draftUnit: { unit: 'LEAGUE', startTime: agoDays(40), draftPick: [{ round: '1', pick: '1', franchise: '0001', player: '1' }] } } };
    default:
      return {};
  }
};
global.fetch = async () => ({ ok: true, json: async () => [] });

const waivers = require('../../src/services/waivers');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const ov = await waivers.getOverview('ck', 'tk');
  const byId = Object.fromEntries(ov.leagues.map((l) => [String(l.leagueId), l]));

  assert(byId.L1.waiverImminent === true, 'L1 (2d) is imminent');
  assert(byId.L2.waiverImminent === false, 'L2 (10d) is NOT imminent');
  assert(byId.L3.waiverImminent === true, 'L3 (weekly, next 1d) is imminent via the `happens` expansion');
  assert(byId.L4.waiverImminent === false, 'L4 (lock event only) is NOT imminent');
  console.log('L1..L4 imminent:', ov.leagues.map((l) => `${l.leagueId}=${l.waiverImminent}`).join(' '));

  // nextWaiverRun timestamps are future and ordered as expected.
  assert(byId.L1.nextWaiverRun > Date.now() && byId.L1.nextWaiverRun < byId.L2.nextWaiverRun, 'L1 run is sooner than L2');
  assert(byId.L4.nextWaiverRun == null, 'L4 has no next run');

  assert(ov.summary.imminent === 2, `exactly two leagues are imminent (got ${ov.summary.imminent})`);
  console.log('✓ waiver imminence: 2d + weekly-next-1d flagged; 10d + lock-only not; summary.imminent=2');

  // The Home triage surfaces a waiver_imminent item for the imminent leagues.
  const portfolio = require('../../src/services/portfolio');
  const home = await portfolio.getHome('ck', 'tk');
  const imminentItems = home.triage.filter((i) => i.type === 'waiver_imminent');
  const leaguesFlagged = new Set(imminentItems.map((i) => String(i.leagueId)));
  assert(leaguesFlagged.has('L1') && leaguesFlagged.has('L3'), 'Home triage flags L1 and L3');
  assert(!leaguesFlagged.has('L2') && !leaguesFlagged.has('L4'), 'Home triage does not flag L2/L4');
  assert(imminentItems.every((i) => i.action === 'waiver' && /process/i.test(i.title)), 'imminent item deep-links to waivers and reads sensibly');
  console.log('✓ home triage: waiver_imminent items for L1 + L3 only');

  console.log('\nWAIVER IMMINENT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
