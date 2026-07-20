'use strict';
// Waivers aren't always running. Most commonly a league's free agency is locked
// until its draft happens (a startup/rookie draft pending). We infer that from
// draft state — a scheduled or in-progress draft => locked — and surface it on the
// waiver overview + suggestions so the wizard skips those leagues instead of
// offering claims that would bounce.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

const nowSec = Math.floor(Date.now() / 1000);
const PLAYERS = [
  { id: '1', name: 'Starter, A', position: 'RB', team: 'AAA' },
  { id: '2', name: 'Bench, B', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free, C', position: 'RB', team: 'CCC' },
];

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: 'L1', name: 'Pre-Draft Startup', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001' }] } };
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
      // A scheduled draft: has a start time, no picks made yet.
      return { draftResults: { draftUnit: { unit: 'LEAGUE', startTime: String(nowSec + 3 * 86400), draftPick: [{ round: '1', pick: '1', franchise: '0001', player: '' }] } } };
    default:
      return {};
  }
};
global.fetch = async () => ({ ok: true, json: async () => [] });

const waivers = require('../../src/services/waivers');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const sug = await waivers.getSuggestions('ck', 'tk');
  const l = sug.leagues[0];
  console.log('suggestions league:', JSON.stringify({ locked: l.locked, reason: l.lockReason, rec: l.recommended, cands: (l.candidates || []).length }));
  assert(l.locked === true, 'a league with a scheduled draft is locked');
  assert(/draft/i.test(l.lockReason || ''), 'the lock reason names the draft');
  assert(l.recommended === null, 'no claim is recommended while waivers are locked');
  assert(sug.summary.locked === 1, 'summary counts locked leagues');
  console.log('✓ getSuggestions: pre-draft league locked —', l.lockReason);

  const ov = await waivers.getOverview('ck', 'tk');
  assert(ov.leagues[0].locked === true && ov.summary.locked === 1, 'overview marks the pre-draft league locked');
  console.log('✓ getOverview: pre-draft league flagged locked on the landing');

  console.log('\nWAIVER LOCK HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
