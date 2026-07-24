'use strict';
// Live waivers: settings carry waiver priority (#7), a hard settings failure
// surfaces instead of faking an unlimited free-agency board (#7), free-agent
// availability is validated so you can't claim a rostered player (#8), and a
// player's upcoming NFL schedule is surfaced from MFL with no fabricated
// difficulty (#9).
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '5';

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My Starter', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My Bench', position: 'WR', team: 'BBB' },
  { id: '50', name: 'Free RB', position: 'RB', team: 'CCC' },
  { id: '99', name: 'Rostered Elsewhere', position: 'WR', team: 'DDD' },
];
const SCHED = {
  5: [{ team: [{ id: 'CCC' }, { id: 'ZZZ' }] }], // CCC away @ ZZZ
  6: [{ team: [{ id: 'QQQ' }, { id: 'CCC' }] }], // CCC home vs QQQ
  7: [], // CCC bye -> absent
  8: [{ team: [{ id: 'CCC' }, { id: 'RRR' }] }], // CCC away @ RRR
};

function baseExport(type, opts = {}) {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: 'L1', name: 'Test League', url: 'https://www10.myfantasyleague.com/2026/home/L1', franchise_id: '0001', franchise_name: 'Me' }] } };
    case 'league':
      return { league: {
        rosterSize: '2', minBid: '1', bbidWaivers: '1',
        franchises: { franchise: [{ id: '0001', bbidAvailableBalance: '80', waiverSortOrder: '3' }] },
        starters: { position: [{ name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: [{ id: opts.FRANCHISE || '0001', player: [{ id: '1', status: 'starter' }, { id: '2', status: 'nonstarter' }] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '50' }] } } }; // only 50 is available
    case 'players':
      return { players: { player: PLAYERS } };
    case 'nflSchedule':
      return { nflSchedule: { week: '5', matchup: SCHED[Number(opts.W)] || [] } };
    default:
      return {};
  }
}
mfl.exportRequest = async (type, opts) => baseExport(type, opts);
global.fetch = async () => ({ ok: true, json: async () => [] }); // FantasyCalc/Sleeper empty

const waivers = require('../../src/services/waivers');
const nflLib = require('../../src/lib/nfl');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const CK = 'ck', TK = 'tk';

(async () => {
  // #7 — settings parse budget-remaining + waiver priority; roster full detected.
  const board = await waivers.getBoard(CK, TK, 'L1', {});
  console.log('settings:', JSON.stringify({ system: board.system, ...board.settings, rosterCount: board.rosterCount, full: board.rosterFull }));
  assert(board.system === 'faab', 'FAAB system detected');
  assert(board.settings.faabRemaining === 80, `faab remaining 80, got ${board.settings.faabRemaining}`);
  assert(board.settings.waiverPriority === 3, `waiver priority 3, got ${board.settings.waiverPriority}`);
  assert(board.rosterFull === true, 'roster 2/2 detected full');
  console.log('✓ #7 live settings: budget + waiver priority parsed, roster fullness real');

  // #8 — a real free agent validates; a player rostered elsewhere is rejected.
  const okFa = await waivers.preview(CK, TK, 'L1', { addId: '50', dropId: '2' });
  assert(!okFa.errors.some((e) => /not available/i.test(e)), 'free agent 50 accepted');
  assert(okFa.valid, `claim valid with a drop, errors: ${okFa.errors.join('; ')}`);
  // Net dynasty value delta (add value − drop value) is surfaced for the side-by-side UI. Null when
  // the add has no known value (no enrichment in this harness); otherwise add − (drop || 0).
  assert(okFa.add && okFa.drop, 'preview carries both add and drop for the value comparison');
  assert('valueDelta' in okFa, 'preview exposes valueDelta');
  const expectedDelta = okFa.add.value != null ? Math.round((okFa.add.value || 0) - (okFa.drop.value || 0)) : null;
  assert(okFa.valueDelta === expectedDelta, `valueDelta = add − drop (or null): got ${okFa.valueDelta}, expected ${expectedDelta}`);
  const badFa = await waivers.preview(CK, TK, 'L1', { addId: '99', dropId: '2' });
  assert(badFa.errors.some((e) => /not available/i.test(e)), 'player rostered elsewhere rejected in live');
  console.log('✓ #8 live free-agent validation: FA accepted, non-FA rejected');

  // #9 — upcoming opponents from MFL schedule, bye skipped, no fake difficulty.
  const sos = await nflLib.upcomingOpponents(CK, 'CCC', 5, 4);
  console.log('schedule:', JSON.stringify(sos));
  assert(sos.length === 3, `3 games (bye skipped), got ${sos.length}`);
  assert(sos[0].week === 5 && sos[0].opp === '@ZZZ' && sos[0].difficulty === null, 'wk5 away @ZZZ, difficulty null');
  assert(sos[1].opp === 'QQQ', 'wk6 home vs QQQ (no @)');
  assert(sos[2].opp === '@RRR', 'wk8 away @RRR (wk7 bye skipped)');
  console.log('✓ #9 live strength-of-schedule: real opponents, difficulty null (not fabricated)');

  // #7 — a hard settings failure surfaces as an error, not a fabricated board.
  mfl.exportRequest = async (type, opts) => { if (type === 'league') throw new Error('MFL down'); return baseExport(type, opts); };
  let threw = false;
  try { await waivers.getBoard(CK, TK, 'L1', {}); } catch (e) { threw = true; }
  mfl.exportRequest = async (type, opts) => baseExport(type, opts);
  assert(threw, 'settings failure surfaces as an error, not a fake free/99 board');
  console.log('✓ #7 settings failure no longer fabricates an unlimited free-agency board');

  console.log('\nWAIVERS LIVE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
