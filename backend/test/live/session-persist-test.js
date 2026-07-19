'use strict';
// Durable sessions (audit #21): with SESSION_SECRET set, a session survives a
// restart, encrypted at rest — and the MFL cookie is never stored in plaintext.
// A wrong secret can't read it, and without a secret nothing is persisted.
const os = require('os');
const path = require('path');
const fs = require('fs');

const DIR = path.join(os.tmpdir(), `dc-sess-${process.pid}`);
fs.rmSync(DIR, { recursive: true, force: true });
process.env.MFL_DEMO_MODE = 'true';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// (Re)load the session + persist + config modules with a given secret/dir,
// simulating a fresh process.
function boot(secret, dir) {
  for (const m of ['../../src/store/sessions', '../../src/store/persist', '../../src/config']) {
    delete require.cache[require.resolve(m)];
  }
  process.env.DATA_DIR = dir;
  if (secret === null) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = secret;
  return require('../../src/store/sessions');
}

(function () {
  const COOKIE = 'MFL_SESSION_COOKIE_ABC123';

  // Boot with a secret, create a session, flush to disk.
  let sessions = boot('secret-A', DIR);
  const token = sessions.create({ cookie: COOKIE, username: 'me' });
  require('../../src/store/persist').flush();

  // The on-disk file must NOT contain the plaintext cookie.
  const onDisk = fs.readFileSync(path.join(DIR, 'state.json'), 'utf8');
  assert(!onDisk.includes(COOKIE), 'MFL cookie is NOT stored in plaintext on disk');
  console.log('✓ cookie encrypted at rest (plaintext not present in state.json)');

  // Restart with the SAME secret -> session restored and cookie decrypts.
  sessions = boot('secret-A', DIR);
  const s = sessions.get(token);
  assert(s && s.cookie === COOKIE, 'session restored + decrypted after restart with the right secret');
  console.log('✓ session survives a restart when SESSION_SECRET is set');

  // Restart with a WRONG secret -> cannot read it (auth fails safe).
  sessions = boot('secret-B', DIR);
  assert(sessions.get(token) === null, 'a wrong SESSION_SECRET cannot decrypt the session');
  console.log('✓ wrong secret cannot read persisted sessions');

  // No secret at all -> sessions are in-memory only (not persisted).
  const fresh = path.join(DIR, 'nosecret');
  let s2 = boot(null, fresh);
  const t2 = s2.create({ cookie: 'X', username: 'y' });
  require('../../src/store/persist').flush();
  s2 = boot(null, fresh);
  assert(s2.get(t2) === null, 'without SESSION_SECRET sessions are not persisted');
  console.log('✓ without SESSION_SECRET sessions stay in-memory only (safe default)');

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('\nSESSION PERSIST HARNESS PASSED');
})();
