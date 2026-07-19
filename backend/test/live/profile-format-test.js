'use strict';
// A player's dynasty value is format-aware PER LEAGUE on the profile (P1): the
// same QB is worth far more in a superflex league than a 1QB league, and the
// profile now shows each league's own value plus the spread across your formats.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

// FantasyCalc returns format-specific values (the request carries numQbs). QB is
// cheap at 1QB (3000 vs a 9000 WR -> normalizes to 33) and elite at superflex
// (9500 -> 100).
global.fetch = async (url) => {
  let data = [];
  if (String(url).includes('fantasycalc')) {
    const sf = /numQbs=2/.test(url);
    data = [
      { player: { mflId: '99', sleeperId: 's99', maybeAge: 25 }, value: sf ? 9500 : 3000, overallRank: sf ? 1 : 20 },
      { player: { mflId: '1', sleeperId: 's1', maybeAge: 26 }, value: 9000, overallRank: 1 },
    ];
  }
  return { ok: true, json: async () => data };
};

const PLAYERS = [
  { id: '99', name: 'Elite, QB', position: 'QB', team: 'CCC' },
  { id: '1', name: 'Star, WR', position: 'WR', team: 'AAA' },
];

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [
        { league_id: 'ONEQB', name: 'Standard 1QB', url: 'https://www10.myfantasyleague.com/2026/home/ONEQB', franchise_id: '0001', franchise_name: 'Me' },
        { league_id: 'SUPERFLEX', name: 'Superflex Dynasty', url: 'https://www10.myfantasyleague.com/2026/home/SUPERFLEX', franchise_id: '0001', franchise_name: 'Me' },
      ] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      // Superflex league has a QB-eligible flex -> numQbs 2; the other is 1QB.
      if (opts.L === 'SUPERFLEX') {
        return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'QB|RB|WR|TE', limit: '1' }, { name: 'RB', limit: '1' }] } } };
      }
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] } } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: [{ id: '99', status: 'starter' }] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [] } } };
    default:
      return {};
  }
};

const playerhub = require('../../src/services/playerhub');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const prof = await playerhub.profile('ck', 'tk', '99');
  const byLeague = Object.fromEntries(prof.crossLeague.map((c) => [c.leagueId, c]));
  console.log('per-league:', JSON.stringify(prof.crossLeague.map((c) => ({ n: c.name, v: c.value, f: c.format }))));
  console.log('valueRange:', JSON.stringify(prof.valueRange));

  assert(byLeague.ONEQB.value === 33, `QB is 33 in 1QB (3000/9000), got ${byLeague.ONEQB.value}`);
  assert(byLeague.SUPERFLEX.value === 100, `QB is 100 in superflex (9500 max), got ${byLeague.SUPERFLEX.value}`);
  assert(byLeague.SUPERFLEX.value > byLeague.ONEQB.value, 'QB worth more in superflex than 1QB');
  assert(/Superflex/.test(byLeague.SUPERFLEX.format) && /1QB/.test(byLeague.ONEQB.format), 'per-league format label shown');
  assert(prof.valueRange && prof.valueRange.min === 33 && prof.valueRange.max === 100, `valueRange spans 33-100, got ${JSON.stringify(prof.valueRange)}`);
  console.log('✓ profile shows format-aware per-league value + the spread across your formats');

  console.log('\nPROFILE FORMAT-AWARE VALUE TEST PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
