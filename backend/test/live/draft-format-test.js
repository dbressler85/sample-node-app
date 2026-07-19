'use strict';
// Verify live drafts are no longer assumed snake: the type is inferred from the
// grid (round 2 reversed => snake, same => linear) and labeled honestly, falling
// back to snake only when indeterminable. Covers audit item #10.
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '20', name: 'Picked, Guy', position: 'WR', team: 'AAA' },
  { id: '30', name: 'Avail, One', position: 'RB', team: 'BBB' },
];

// Three leagues with different draft grids.
const GRIDS = {
  LINEAR: [ // round 2 same order as round 1 -> linear
    { round: '1', pick: '1', franchise: '0001', player: '20' },
    { round: '1', pick: '2', franchise: '0002', player: '' },
    { round: '2', pick: '1', franchise: '0001', player: '' },
    { round: '2', pick: '2', franchise: '0002', player: '' },
  ],
  SNAKE: [ // round 2 reversed -> snake
    { round: '1', pick: '1', franchise: '0001', player: '20' },
    { round: '1', pick: '2', franchise: '0002', player: '' },
    { round: '2', pick: '1', franchise: '0002', player: '' },
    { round: '2', pick: '2', franchise: '0001', player: '' },
  ],
  SOLO: [ // only round 1 present -> indeterminate -> default snake
    { round: '1', pick: '1', franchise: '0001', player: '20' },
    { round: '1', pick: '2', franchise: '0002', player: '' },
  ],
};

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: ['LINEAR', 'SNAKE', 'SOLO'].map((id) => ({
        league_id: id, name: id, url: `https://www10.myfantasyleague.com/2026/home/${id}`, franchise_id: '0001', franchise_name: 'Me',
      })) } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }] } } };
    case 'draftResults':
      return { draftResults: { draftUnit: [{ unit: 'LEAGUE', startTime: '1754000000', draftPick: GRIDS[opts.L] || [] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '30' }] } } };
    default:
      return {};
  }
};
global.fetch = async () => ({ ok: true, json: async () => [] });

const draft = require('../../src/services/draft');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const CK = 'ck', TK = 'tk';

(async () => {
  const linear = await draft.getLeague(CK, TK, 'LINEAR');
  console.log('LINEAR:', linear.type, 'snake=', linear.snake);
  assert(linear.snake === false && linear.type === 'Linear draft', `linear detected, got ${linear.type}/${linear.snake}`);
  // Board keeps MFL's real linear order: round 2 pick 1 is the same franchise as round 1 pick 1.
  const r2p1 = linear.board.find((s) => s.round === 2 && s.pick === 1);
  assert(r2p1.franchiseId === '0001', 'linear order preserved on the board');

  const snake = await draft.getLeague(CK, TK, 'SNAKE');
  console.log('SNAKE:', snake.type, 'snake=', snake.snake);
  assert(snake.snake === true && snake.type === 'Snake draft', `snake detected, got ${snake.type}/${snake.snake}`);

  const solo = await draft.getLeague(CK, TK, 'SOLO');
  console.log('SOLO:', solo.type, 'snake=', solo.snake);
  assert(solo.snake === true && solo.type === 'Draft', `indeterminate defaults to snake w/ generic label, got ${solo.type}/${solo.snake}`);

  console.log('\nDRAFT FORMAT DETECTION TEST PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
