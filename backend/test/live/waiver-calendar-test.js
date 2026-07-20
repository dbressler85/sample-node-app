'use strict';
// The AUTHORITATIVE waiver-lock signal is MFL's league calendar (TYPE=calendar),
// which holds the events that actually control transactions — "Lock All Free
// Agents" / "Allow Add/Drops". This exercises the calendar path directly:
//   * a league whose most recent past FA event is a LOCK  => locked (calendar reason)
//   * a league whose most recent past FA event is UNLOCK  => open (not locked)
//   * a future lock event that hasn't happened yet is ignored
// The draft heuristic is the fallback; here the drafts are done, so any lock must
// come from the calendar, proving the calendar path stands on its own.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

const nowSec = Math.floor(Date.now() / 1000);
const past = (days) => String(nowSec - days * 86400);
const future = (days) => String(nowSec + days * 86400);

const PLAYERS = [
  { id: '1', name: 'Starter, A', position: 'RB', team: 'AAA' },
  { id: '2', name: 'Bench, B', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free, C', position: 'RB', team: 'CCC' },
];

// Two leagues: L1's last FA event is a lock (locked now); L2's last FA event is an
// unlock (open now). Both drafts are COMPLETE so the draft heuristic marks neither
// locked — any lock therefore proves the calendar path is doing the work.
const CALENDARS = {
  L1: { calendar: { event: [
    { title: 'Allow Add/Drops', start: past(30) },
    { title: 'Lock All Free Agents', start: past(2) },   // most recent -> locked
    { title: 'Allow Add/Drops', start: future(5) },       // future -> ignored
  ] } },
  L2: { calendar: { event: [
    { title: 'Lock All Free Agents', start: past(20) },
    { title: 'Allow Add/Drops', start: past(1) },         // most recent -> open
    { title: 'Lock All Free Agents', start: future(3) },  // future -> ignored
  ] } },
};

const LEAGUES = [
  { league_id: 'L1', name: 'Locked By Calendar', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001' },
  { league_id: 'L2', name: 'Open By Calendar', url: 'https://www10.myfantasyleague.com/2026/home/L2', franchise_id: '0001' },
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
      // A completed draft: picks are filled in, so the draft heuristic won't lock.
      return { draftResults: { draftUnit: { unit: 'LEAGUE', startTime: past(40), draftPick: [{ round: '1', pick: '1', franchise: '0001', player: '1' }] } } };
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

  const l1 = byId.L1;
  console.log('L1:', JSON.stringify({ locked: l1.locked, reason: l1.lockReason }));
  assert(l1.locked === true, 'L1 is locked (its most recent past FA event is a lock)');
  assert(/calendar/i.test(l1.lockReason || ''), 'L1 lock reason cites the calendar, not the draft');

  const l2 = byId.L2;
  console.log('L2:', JSON.stringify({ locked: l2.locked, reason: l2.lockReason }));
  assert(!l2.locked, 'L2 is open (its most recent past FA event is an unlock)');

  assert(ov.summary.locked === 1, 'exactly one league counts as locked');
  console.log('✓ calendar lock: L1 locked via calendar, L2 open, future events ignored');

  console.log('\nWAIVER CALENDAR HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
