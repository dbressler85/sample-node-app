'use strict';
// The big MFL player database persists to the durable store when a real DATA_DIR is
// configured, so a restart reloads it from disk instead of re-downloading the whole NFL
// universe. This drives it into an isolated temp DATA_DIR: first load fetches once and
// persists; after a simulated restart (reload persist from disk + fresh players module),
// the next load rehydrates from disk with NO second fetch.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolated data dir (must be set BEFORE config/persist are required) — never touches the
// shared state.json. Enables persistPlayers (defaults on when DATA_DIR is set).
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'players-persist-'));
process.env.DATA_DIR = DIR;
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');
const config = require('../../src/config');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

let fetches = 0;
mfl.exportRequest = async (type) => {
  if (type === 'players') {
    fetches += 1;
    return { players: { player: [
      { id: '1', name: 'Allen, Josh', position: 'QB', team: 'BUF' },
      { id: '2', name: 'Chase, Ja\'Marr', position: 'WR', team: 'CIN' },
      { id: '3', name: 'Bowers, Brock', position: 'TE', team: 'LV' },
    ] } };
  }
  return {};
};

(async () => {
  assert(config.persistPlayers === true, 'persistPlayers is on when DATA_DIR is set');

  const players1 = require('../../src/lib/players');
  const m1 = await players1.load('ck');
  assert(m1.size === 3 && m1.get('2').name.includes('Chase'), 'first load builds the player map');
  assert(fetches === 1, 'first load fetched the players export once');
  console.log(`✓ first load: fetched ${fetches} time, ${m1.size} players, persisted to ${path.basename(DIR)}/state.json`);

  // Simulate a process restart: flush + reload persist from disk, and re-require players so
  // its in-memory cache is empty (as it would be after a real restart).
  const persist = require('../../src/store/persist');
  persist._reloadFromDisk();
  assert(fs.existsSync(path.join(DIR, 'state.json')), 'state.json written to the data dir');

  delete require.cache[require.resolve('../../src/lib/players')];
  const players2 = require('../../src/lib/players');
  const m2 = await players2.load('ck');
  assert(m2.size === 3 && m2.get('3').name.includes('Bowers'), 'post-restart load rehydrates the full map');
  assert(fetches === 1, 'post-restart load did NOT re-fetch — it came from disk');
  console.log(`✓ after restart: rehydrated ${m2.size} players from disk, still only ${fetches} fetch total`);

  // Cleanup the temp dir.
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ }

  console.log('\nPLAYERS PERSIST HARNESS PASSED');
})().catch((e) => { console.error(e.message); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (x) {} process.exit(1); });
