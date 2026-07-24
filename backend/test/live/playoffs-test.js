'use strict';
// Playoff-bracket service. Demo returns a hand-built Championship bracket; live normalizes MFL's
// playoffBrackets export into the SAME rounds→games shape (my franchise flagged, winners resolved).
// The live per-game field names aren't confirmed against a real sample yet, so the normalizer is
// tolerant — this pins that BOTH a nested-object shape and a flat shape normalize identically.

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // --- DEMO ---------------------------------------------------------------------------------------
  process.env.MFL_DEMO_MODE = 'true';
  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/services/playoffs')];
  const playoffsDemo = require('../../src/services/playoffs');
  const demo = require('../../src/demo/fixtures');
  const anyLeague = demo.leagues()[0].leagueId;
  const d = await playoffsDemo.getBrackets('ck', anyLeague);
  assert(d.available && d.brackets.length >= 1, 'demo has a bracket');
  const champ = d.brackets[0];
  assert(champ.rounds.length === 3, `3 rounds, got ${champ.rounds.length}`);
  assert(champ.rounds[2].title === 'Championship' && champ.rounds[2].games.length === 1, 'final round is a single championship game');
  const finalGame = champ.rounds[2].games[0];
  assert(finalGame.winnerFranchiseId && finalGame.status === 'final', 'final game has a winner');
  assert(champ.rounds.some((r) => r.games.some((g) => g.mine)), 'my franchise appears in the bracket');
  assert(finalGame.home.points != null && finalGame.away.points != null, 'games carry points');
  console.log('✓ demo: 3-round Championship bracket with winners, points, my-team flag');

  // --- LIVE: nested-object game shape -------------------------------------------------------------
  process.env.MFL_DEMO_MODE = 'false';
  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/services/playoffs')];
  const mflRepo = require('../../src/lib/mflRepo');
  const leaguesService = require('../../src/services/leagues');
  leaguesService.listLeagues = async () => [{ leagueId: 'L1', name: 'PO League', host: 'www10.myfantasyleague.com', franchiseId: '0002' }];
  leaguesService.franchiseNames = async () => new Map([['0001', 'Alpha'], ['0002', 'Bravo (me)'], ['0003', 'Charlie'], ['0004', 'Delta']]);

  const playoffs = require('../../src/services/playoffs');

  mflRepo.playoffBrackets = async () => [
    {
      id: '1', name: 'Championship',
      playoffRound: [
        { week: '15', playoffGame: [
          { id: 'g1', home: { franchise_id: '0001', points: '95.5', seed: '1' }, away: { franchise_id: '0004', points: '101.2', seed: '4' }, winner: '0004' },
          { id: 'g2', home: { franchise_id: '0002', points: '120.0', seed: '2' }, away: { franchise_id: '0003', points: '99.9', seed: '3' }, winner: '0002' },
        ] },
        { week: '16', playoffGame: [
          { id: 'g3', home: { franchise_id: '0002', points: '110.0' }, away: { franchise_id: '0004', points: '108.0' }, winner: '0002' },
        ] },
      ],
    },
  ];
  const L = await playoffs.getBrackets('ck', 'L1');
  assert(L.available && L.brackets.length === 1, 'live bracket available');
  const r0 = L.brackets[0].rounds[0];
  assert(r0.week === 15 && r0.games.length === 2, `round 1: week 15, 2 games, got week ${r0.week}/${r0.games.length}`);
  const g1 = r0.games[0];
  assert(g1.away.franchiseId === '0004' && g1.away.name === 'Delta' && g1.away.points === 101.2 && g1.away.seed === 4, `side resolved: ${JSON.stringify(g1.away)}`);
  assert(g1.winnerFranchiseId === '0004' && g1.status === 'final', 'winner + final status');
  assert(r0.games[1].mine === true, 'my franchise (0002) flagged on its game');
  assert(L.brackets[0].rounds[1].title === 'Championship', 'last round auto-titled Championship');
  console.log('✓ live (nested objects): rounds/games/sides/winner/mine normalized');

  // --- LIVE: flat game shape + `round`/`game` aliases + no winner yet (scheduled) ------------------
  delete require.cache[require.resolve('../../src/services/playoffs')];
  const playoffs2 = require('../../src/services/playoffs');
  mflRepo.playoffBrackets = async () => [
    { bracket_id: '9', bracket_name: 'Consolation', round: [
      { w: '15', game: [{ game_id: 'x', home_franchise: '0001', away_franchise: '0002' }] },
    ] },
  ];
  const F = await playoffs2.getBrackets('ck', 'L1');
  const g = F.brackets[0].rounds[0].games[0];
  assert(F.brackets[0].name === 'Consolation', 'bracket_name alias honored');
  assert(g.home.franchiseId === '0001' && g.away.franchiseId === '0002', `flat home/away ids: ${JSON.stringify([g.home, g.away])}`);
  assert(g.winnerFranchiseId === null && g.status === 'scheduled', 'no points/winner → scheduled');
  console.log('✓ live (flat shape + aliases): still normalizes, scheduled status');

  // --- LIVE: read failure → fail-soft "unavailable" (never a 500) ---------------------------------
  delete require.cache[require.resolve('../../src/services/playoffs')];
  const playoffs3 = require('../../src/services/playoffs');
  mflRepo.playoffBrackets = async () => { throw new Error('boom'); };
  const E = await playoffs3.getBrackets('ck', 'L1');
  assert(E.available === false && Array.isArray(E.brackets) && E.brackets.length === 0, 'read failure → available:false, empty');
  console.log('✓ live: read failure is fail-soft (available:false)');

  console.log('\nPLAYOFFS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
