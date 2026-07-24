'use strict';
// The dynasty outlook blends ROSTER STRENGTH (value vs the rest of the league) with
// CORE AGE — not age alone. This proves the improvement directly: two of my teams
// with an IDENTICAL young core land in different buckets purely because one roster is
// the strongest in its league and the other is the weakest.
//   League A: young core + strongest roster  -> Ascending
//   League B: young core + weakest roster     -> Rebuilding
// Plus a unit sweep of computeOutlook across the strength × age grid.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK; // offseason -> dynasty summary path

const mfl = require('../../src/lib/mfl');
const roster = require('../../src/services/roster');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// --- unit: the model grid --------------------------------------------------
const c = roster.computeOutlook;
assert(c(29, 0.9) === 'Win-now window', 'old + strong -> win-now');
assert(c(26, 0.9) === 'Win-now window', 'mid-age + strong -> win-now');
assert(c(23, 0.9) === 'Ascending', 'young + strong -> ascending (bright future, no rush)');
assert(c(23, 0.5) === 'Ascending', 'young + middling -> ascending');
assert(c(23, 0.2) === 'Rebuilding', 'young + weak -> rebuilding (youth but not there yet)');
assert(c(29, 0.2) === 'Rebuilding', 'old + weak -> rebuilding (reset)');
assert(c(26, 0.5) === 'Balanced', 'mid + mid -> balanced');
assert(c(23, null) === 'Ascending', 'no strength known -> age lean (young)');
assert(c(29, null) === 'Balanced', 'no strength known -> age lean (not young) stays balanced');
console.log('✓ unit: computeOutlook blends strength × age across the grid');

// --- unit: strengthLabel shares computeOutlook's 0.55/0.45 thresholds (client sources this) ---
const sl = roster.strengthLabel;
assert(sl(0.9) === 'strong roster', 'high pct -> strong roster');
assert(sl(0.55) === 'strong roster', 'threshold 0.55 -> strong roster');
assert(sl(0.5) === 'middle of the pack', 'mid pct -> middle of the pack');
assert(sl(0.45) === 'thin roster', 'threshold 0.45 -> thin roster');
assert(sl(0.1) === 'thin roster', 'low pct -> thin roster');
assert(sl(null) === null, 'unknown strength -> no label');
console.log('✓ unit: strengthLabel matches the outlook thresholds (single source of truth)');

// --- live path: strength splits identical-age teams -------------------------
const PLAYERS = [
  { id: '1', name: 'My Star, A', position: 'WR', team: 'AAA' },
  { id: '2', name: 'My Back, B', position: 'RB', team: 'BBB' },
  { id: '10', name: 'Weak One, C', position: 'WR', team: 'CCC' },
  { id: '11', name: 'Weak Two, D', position: 'RB', team: 'DDD' },
  { id: '12', name: 'Stud One, E', position: 'WR', team: 'EEE' },
  { id: '13', name: 'Stud Two, F', position: 'RB', team: 'FFF' },
];

// My roster (ids 1,2) is the SAME young core in both leagues. Opponents differ:
// league 1000's rivals are cheap (I'm strongest); league 2000's rivals are studs
// (I'm weakest).
const ROSTERS = {
  '1000': [
    { id: '0001', player: ['1', '2'].map((id) => ({ id, status: 'starter' })) },
    { id: '0002', player: [{ id: '10', status: 'starter' }] },
    { id: '0003', player: [{ id: '11', status: 'starter' }] },
  ],
  '2000': [
    { id: '0001', player: ['1', '2'].map((id) => ({ id, status: 'starter' })) },
    { id: '0002', player: [{ id: '12', status: 'starter' }] },
    { id: '0003', player: [{ id: '13', status: 'starter' }] },
  ],
};

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [
        { league_id: '1000', name: 'Strong Here', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' },
        { league_id: '2000', name: 'Weak Here', url: 'https://www10.myfantasyleague.com/2026/home/2000', franchise_id: '0001', franchise_name: 'My Team' },
      ] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: { starters: { position: [{ name: 'WR', limit: '1' }, { name: 'RB', limit: '1' }] }, franchises: { franchise: [{ id: '0001' }, { id: '0002' }, { id: '0003' }] } } };
    case 'rosters':
      return { rosters: { franchise: ROSTERS[opts.L] || ROSTERS['1000'] } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    case 'pendingTrades':
      return {};
    default:
      return {};
  }
};

// Dynasty values via FantasyCalc: my core is young; rivals in 2000 dwarf my value.
const FC = [
  { player: { mflId: '1', maybeAge: 23 }, value: 9000, overallRank: 3 },
  { player: { mflId: '2', maybeAge: 24 }, value: 4500, overallRank: 25 },
  { player: { mflId: '10', maybeAge: 28 }, value: 700, overallRank: 240 },
  { player: { mflId: '11', maybeAge: 29 }, value: 700, overallRank: 250 },
  { player: { mflId: '12', maybeAge: 26 }, value: 18000, overallRank: 1 },
  { player: { mflId: '13', maybeAge: 26 }, value: 18000, overallRank: 1 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const portfolio = require('../../src/services/portfolio');

(async () => {
  const CK = 'ck', TK = 'tk';

  const a = await portfolio.getLeagueTriage(CK, TK, '1000');
  const b = await portfolio.getLeagueTriage(CK, TK, '2000');
  console.log('A (strong):', JSON.stringify(a.dynasty));
  console.log('B (weak):  ', JSON.stringify(b.dynasty));

  assert(a.dynasty.coreAge === b.dynasty.coreAge, `same core age in both leagues (${a.dynasty.coreAge} vs ${b.dynasty.coreAge})`);
  assert(a.dynasty.strengthPct > b.dynasty.strengthPct, `strength ranks me higher in A (${a.dynasty.strengthPct}) than B (${b.dynasty.strengthPct})`);
  assert(a.dynasty.outlook === 'Ascending', `A: young + strongest -> Ascending, got ${a.dynasty.outlook}`);
  assert(b.dynasty.outlook === 'Rebuilding', `B: young + weakest -> Rebuilding, got ${b.dynasty.outlook}`);
  console.log('✓ live: identical young core -> Ascending when strongest, Rebuilding when weakest');

  const home = await portfolio.getHome(CK, TK);
  console.log('rollup:', JSON.stringify({ ascending: home.portfolio.ascending, rebuilding: home.portfolio.rebuilding, winNow: home.portfolio.contenders, balanced: home.portfolio.balanced }));
  const sum = home.portfolio.ascending + home.portfolio.rebuilding + home.portfolio.contenders + home.portfolio.balanced;
  assert(sum === home.portfolio.leagues, `outlook buckets sum to league count (${sum} vs ${home.portfolio.leagues})`);
  assert(home.portfolio.ascending === 1 && home.portfolio.rebuilding === 1, 'rollup counts one Ascending + one Rebuilding');
  console.log('✓ rollup: the four buckets are exhaustive (sum to league count)');

  console.log('\nDYNASTY OUTLOOK HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
