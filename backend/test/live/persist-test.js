'use strict';
// Durable app state (audit #22): waiver/trade/drop/lineup/draft stores survive a
// restart. We write via each store, force a flush + reload from disk (simulating
// a process restart), and assert everything comes back — including id-counter
// continuity so new records don't collide with pre-restart ones.
const os = require('os');
const path = require('path');
const fs = require('fs');

const DIR = path.join(os.tmpdir(), `dc-persist-${process.pid}`);
fs.rmSync(DIR, { recursive: true, force: true });
process.env.DATA_DIR = DIR;
process.env.MFL_DEMO_MODE = 'true';

const persist = require('../../src/store/persist');
const waivers = require('../../src/store/waivers');
const trades = require('../../src/store/trades');
const drops = require('../../src/store/drops');
const lineups = require('../../src/store/lineups');
const draftStore = require('../../src/store/draft');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(function () {
  const TK = 'tok1', LG = 'L1';
  const claim = waivers.add(TK, LG, [], { add: { id: '50', name: 'X' }, bid: 5 });
  const offer = trades.add(TK, LG, [], { withName: 'Rival', acquire: ['1'], send: ['2'] });
  trades.resolve(TK, LG, [], offer.id, 'rejected');
  drops.set(TK, LG, '999');
  lineups.set(TK, LG, ['a', 'b', 'c']);
  draftStore.add(TK, LG, [], { round: 1, pick: 2, franchiseId: '0001', playerId: '30' });

  // Simulate a restart.
  persist._reloadFromDisk();

  assert(fs.existsSync(persist._file), 'state.json written to disk');
  assert(waivers.list(TK, LG).some((c) => c.id === claim.id && c.bid === 5), 'waiver claim survived restart');
  const ro = trades.list(TK, LG).find((o) => o.id === offer.id);
  assert(ro && ro.status === 'rejected', 'trade offer + resolved status survived restart');
  assert(drops.has(TK, LG, '999'), 'drop survived restart');
  assert(JSON.stringify(lineups.get(TK, LG)) === JSON.stringify(['a', 'b', 'c']), 'lineup survived restart');
  assert(draftStore.list(TK, LG).some((p) => p.playerId === '30'), 'draft pick survived restart');

  // Counter continuity across the restart — no id collision.
  const claim2 = waivers.add(TK, LG, [], { add: { id: '51' } });
  assert(claim2.id !== claim.id, `claim ids unique across restart (${claim.id} vs ${claim2.id})`);

  console.log('✓ waiver/trade/drop/lineup/draft state persists and restores across a restart');
  console.log(`✓ id continuity: ${claim.id} -> ${claim2.id}`);

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('\nPERSIST HARNESS PASSED');
})();
