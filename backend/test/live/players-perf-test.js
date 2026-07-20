'use strict';
// The Players screen (rankings/search) builds a cross-league "mine / free" picture. It
// only needs which players are on my roster, so it now uses a LIGHT roster read
// (FRANCHISE-filtered, no enrichment/strength/picks) instead of the full getRoster build,
// and memoizes the per-league gather so repeated calls don't re-fan-out. This proves:
//   * rankings never triggers the heavy roster work (no futureDraftPicks read);
//   * the roster read is franchise-scoped (the light path);
//   * a second rankings() call reuses the gather (no extra roster reads).
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');

const calls = []; // { type, franchise } for each export
const PLAYERS = [
  { id: '1', name: 'A One', position: 'RB', team: 'AAA' },
  { id: '2', name: 'B Two', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free Guy', position: 'WR', team: 'CCC' },
];
mfl.exportRequest = async (type, opts = {}) => {
  calls.push({ type, franchise: opts.FRANCHISE || null });
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [
        { league_id: 'L1', name: 'One', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001' },
        { league_id: 'L2', name: 'Two', url: 'https://www10.myfantasyleague.com/2026/home/L2', franchise_id: '0001' },
      ] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: [{ id: '1', status: 'starter' }, { id: '2', status: 'nonstarter' }] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '50' }] } } };
    case 'injuries':
      return { injuries: { injury: [] } };
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '1', position: 'RB', maybeAge: 25 }, value: 9000, overallRank: 1 },
  { player: { mflId: '2', position: 'WR', maybeAge: 25 }, value: 6000, overallRank: 8 },
  { player: { mflId: '50', position: 'WR', maybeAge: 27 }, value: 3000, overallRank: 40 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const playerhub = require('../../src/services/playerhub');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TOK = 'tok';

  const r1 = await playerhub.rankings(CK, TOK, { type: 'value' });
  const rosterCalls = calls.filter((c) => c.type === 'rosters');
  console.log('after rankings #1:', JSON.stringify(calls.map((c) => c.type + (c.franchise ? `(F${c.franchise})` : ''))));
  assert(r1.players.length > 0, 'rankings returns players');
  assert(r1.players.some((p) => p.mine) && r1.players.some((p) => p.freeInLeagues > 0), 'mine / free badges still resolve');

  // The light path: the roster read is franchise-scoped, and the heavy build's extras
  // (per-league draft picks) are never fetched for the Players screen.
  assert(rosterCalls.length > 0 && rosterCalls.every((c) => c.franchise === '0001'), 'roster reads are franchise-scoped (light path)');
  assert(!calls.some((c) => c.type === 'futureDraftPicks'), 'no draft-pick read (full getRoster build avoided)');
  console.log('✓ Players uses the light roster read — franchise-scoped, no pick/all-franchise build');

  // Second rankings() reuses the memoized gather — no new roster/freeAgent reads.
  const before = calls.filter((c) => c.type === 'rosters' || c.type === 'freeAgents').length;
  await playerhub.rankings(CK, TOK, { type: 'age' });
  const after = calls.filter((c) => c.type === 'rosters' || c.type === 'freeAgents').length;
  console.log(`roster+FA reads: ${before} after first, ${after} after second`);
  assert(after === before, 'the second Players read reuses the gather (no re-fan-out)');
  console.log('✓ gather is memoized — switching rank type does not re-read every league');

  console.log('\nPLAYERS PERF HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
