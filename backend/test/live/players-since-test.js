'use strict';
// Verifies the incremental player-DB refresh. A cold load pulls the full universe; a later
// refresh (after the cache ages out) sends SINCE=<base timestamp> and MERGES the returned
// changes onto the prior snapshot instead of re-downloading everyone. Correctness of the
// merged map is the point — SINCE is the payload optimization on top.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const players = require('../../src/lib/players');

// Record every players export call so we can assert cold=full, refresh=SINCE.
const calls = [];
const FULL = [
  { id: '30', name: 'Best, Available', position: 'RB', team: 'BBB' },
  { id: '31', name: 'Next, Best', position: 'WR', team: 'CCC' },
  { id: '20', name: 'Vet, Eran', position: 'WR', team: 'AAA' },
];
mfl.exportRequest = async (type, opts = {}) => {
  if (type !== 'players') return {};
  calls.push(opts);
  if (opts.SINCE != null) {
    // Only changed players come back on a delta: id 30 changed teams, id 99 is brand new.
    return { players: { player: [
      { id: '30', name: 'Best, Available', position: 'RB', team: 'ZZZ' },
      { id: '99', name: 'Rookie, New', position: 'QB', team: 'DDD' },
    ] } };
  }
  return { players: { player: FULL } };
};

(async () => {
  players._resetForTest();

  // Cold load → full download, no SINCE.
  const first = await players.load('ck');
  assert(calls.length === 1, 'one fetch on cold load');
  assert(calls[0].SINCE == null, 'cold load does NOT send SINCE (full download)');
  assert(calls[0].DETAILS === 1, 'cold load sends DETAILS=1');
  assert(first.size === 3, 'full universe loaded (3 players)');
  assert(first.get('30').team === 'BBB', 'player 30 starts on BBB');
  console.log('✓ cold load: full players?DETAILS=1 download, no SINCE');

  // Age the cache so the next load refreshes, and remember the timestamp we backdate to.
  const baseAtMs = 1_600_000_000_000; // fixed ms → SINCE should be 1_600_000_000
  players._ageCacheForTest(baseAtMs);

  const second = await players.load('ck');
  assert(calls.length === 2, 'a second fetch happened on refresh');
  assert(calls[1].SINCE === Math.floor(baseAtMs / 1000), `refresh sends SINCE=${Math.floor(baseAtMs / 1000)}, got ${calls[1].SINCE}`);
  // Merge correctness: unchanged players survive, the changed one is updated, the new one is added.
  assert(second.size === 4, 'merged map has the original 3 plus the 1 new player');
  assert(second.get('30').team === 'ZZZ', 'changed player 30 updated to ZZZ via the delta');
  assert(second.get('31').team === 'CCC', 'unchanged player 31 survives the merge');
  assert(second.get('20').name === 'Vet, Eran', 'unchanged player 20 survives the merge');
  assert(second.get('99') && second.get('99').position === 'QB', 'brand-new player 99 added from the delta');
  console.log('✓ refresh: SINCE delta merged onto the base (update + add, no re-download)');

  console.log('\nPLAYERS SINCE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
