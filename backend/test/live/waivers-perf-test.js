'use strict';
// The Waivers LANDING (getOverview) only shows, per league, roster size + a free-agent
// count and top 3. It now uses the LIGHT roster read (franchise-scoped, no all-franchise
// valuation/strength) and a LIGHT free-agent summary (memoized ids + values, no
// projectedScores board build / per-player enrichment). This proves the landing no longer
// pays for the heavy board build:
//   * no projectedScores read (that's the board/wizard, not the landing);
//   * roster reads are franchise-scoped (the light path);
//   * the overview still returns roster counts + FA count + top-3.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

const calls = [];
const PLAYERS = [
  { id: '1', name: 'My RB', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My WR', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free WR', position: 'WR', team: 'CCC' },
  { id: '51', name: 'Free RB', position: 'RB', team: 'DDD' },
  { id: '52', name: 'Free TE', position: 'TE', team: 'EEE' },
];
mfl.exportRequest = async (type, opts = {}) => {
  calls.push({ type, franchise: opts.FRANCHISE || null });
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: 'L1', name: 'One', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: { rosterSize: '20', franchises: { franchise: [{ id: '0001' }] }, starters: { position: [{ name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] } } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: [{ id: '1', status: 'starter' }, { id: '2', status: 'nonstarter' }] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '50' }, { id: '51' }, { id: '52' }] } } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'nflSchedule':
      return { nflSchedule: { week: '3', matchup: [] } };
    default:
      return {}; // calendar, draftResults, futureDraftPicks, projectedScores, ...
  }
};
const FC = [
  { player: { mflId: '50', position: 'WR', maybeAge: 25 }, value: 4000, overallRank: 40 },
  { player: { mflId: '51', position: 'RB', maybeAge: 25 }, value: 3000, overallRank: 60 },
  { player: { mflId: '52', position: 'TE', maybeAge: 25 }, value: 2000, overallRank: 90 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const waivers = require('../../src/services/waivers');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const ov = await waivers.getOverview('ck', 'tok');
  const l = ov.leagues[0];
  console.log('overview:', JSON.stringify({ roster: `${l.rosterCount}/${l.rosterSize}`, faCount: l.faCount, top: (l.topAvailable || []).map((p) => p.name) }));
  assert(l.rosterCount === 2 && l.faCount === 3, 'overview still reports roster count + FA count');
  assert(l.topAvailable.length === 3 && l.topAvailable[0].id === '50', 'top available ranked by value');

  const rosterCalls = calls.filter((c) => c.type === 'rosters');
  assert(rosterCalls.length > 0 && rosterCalls.every((c) => c.franchise === '0001'), 'roster reads are franchise-scoped (light path)');
  assert(!calls.some((c) => c.type === 'projectedScores'), 'landing does NOT build the board (no projectedScores fetch)');
  console.log('✓ Waivers landing uses the light roster + light FA summary — no projectedScores board build');

  console.log('\nWAIVERS PERF HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
