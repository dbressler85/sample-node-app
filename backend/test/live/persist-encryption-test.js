'use strict';
// Encryption at rest for PERSONAL app state (docs/DATA_SOURCES.md Q9 → option 1). With SESSION_SECRET
// set, personal namespaces (tags/watchlist/history/trophies/pins/…) are AES-256-GCM encrypted in
// state.json; the public player-DB cache + id counters stay plaintext; and everything round-trips
// (decrypts) on reload. Runs as its own child process so the env is isolated.
const os = require('os');
const path = require('path');
const fs = require('fs');

const DIR = path.join(os.tmpdir(), `dc-persist-enc-${process.pid}`);
fs.rmSync(DIR, { recursive: true, force: true });
process.env.DATA_DIR = DIR;
process.env.SESSION_SECRET = 'test-secret-please-encrypt';
process.env.MFL_DEMO_MODE = 'true';

const persist = require('../../src/store/persist');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(function () {
  // A personal namespace (must be encrypted) + the public player-DB cache (must stay plaintext).
  Object.assign(persist.ns('playerTags'), { 'acct:me': { 30: 'target', 31: 'avoid' } });
  Object.assign(persist.ns('players'), { at: 123, byId: {} });
  persist.touch();
  persist.flushSync();

  const raw = JSON.parse(fs.readFileSync(persist._file, 'utf8'));
  assert(raw.playerTags && raw.playerTags.__enc && raw.playerTags.__enc.ct && raw.playerTags.__enc.iv && raw.playerTags.__enc.tag, 'personal namespace is an { __enc } envelope on disk');
  assert(!/target|avoid|acct:me/.test(JSON.stringify(raw.playerTags)), 'plaintext personal values do NOT appear in the on-disk blob');
  assert(raw.players && raw.players.at === 123 && !raw.players.__enc, 'the public player-DB cache stays plaintext (not personal, and large)');
  console.log('✓ at rest: personal namespaces encrypted (AES-256-GCM); public cache plaintext');

  // Reload from disk (simulated restart) → the personal namespace decrypts back to plaintext.
  persist._reloadFromDisk();
  const tags = persist.ns('playerTags')['acct:me'];
  assert(tags && tags['30'] === 'target' && tags['31'] === 'avoid', 'personal namespace decrypts on reload (round-trip)');
  assert(persist.ns('players').at === 123, 'plaintext namespace also survives reload');
  console.log('✓ round-trip: encrypted personal state decrypts intact on reload');

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('\nPERSIST ENCRYPTION HARNESS PASSED');
})();
