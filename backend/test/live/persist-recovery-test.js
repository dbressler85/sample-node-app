'use strict';
// Persistence hardening: the durable store must survive a corrupt/interrupted state file WITHOUT
// silently destroying recoverable data. load() runs once at require-time, so each scenario runs in its
// own child process with a pre-seeded DATA_DIR; we probe the load outcome through the public ns().
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const PERSIST = path.join(__dirname, '..', '..', 'src', 'store', 'persist');

// Run a child that seeds files into a fresh DATA_DIR, requires persist, then prints a JSON verdict.
// `seed` is source that writes files given `dir` + `fs`/`path`. `probe` is source returning a value
// from the loaded module (has `persist`, `dir`, `fs`, `path` in scope).
function run(label, seed, probe) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dc-precov-${label}-`));
  const code = `
    const fs = require('fs'); const path = require('path');
    const dir = ${JSON.stringify(dir)};
    process.env.DATA_DIR = dir; process.env.MFL_DEMO_MODE = 'true';
    (${seed})(dir, fs, path);
    const persist = require(${JSON.stringify(PERSIST)});
    const out = (${probe})(persist, dir, fs, path);
    process.stdout.write('RESULT:' + JSON.stringify(out));
  `;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`[${label}] child exited ${r.status}: ${r.stderr || r.stdout}`);
  const m = /RESULT:(.*)$/.exec(r.stdout.trim());
  if (!m) throw new Error(`[${label}] no RESULT in child output: ${r.stdout}`);
  return JSON.parse(m[1]);
}

// 1) A corrupt state.json is backed up (not overwritten) and the app starts empty but writable.
{
  const out = run(
    'corrupt',
    (dir, fs, path) => { fs.writeFileSync(path.join(dir, 'state.json'), '{ this is not json '); },
    (persist, dir, fs) => {
      const probeBefore = persist.ns('probe').v; // undefined → loaded empty
      persist.ns('probe').v = 7; persist.flushSync(); // still writable?
      const rewritten = JSON.parse(fs.readFileSync(dir + '/state.json', 'utf8'));
      const backups = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt-'));
      return { probeBefore, backups: backups.length, rewrote: rewritten.probe && rewritten.probe.v };
    }
  );
  assert(out.probeBefore === undefined, 'corrupt file → started empty (no stale data leaked)');
  assert(out.backups === 1, 'corrupt file preserved as a .corrupt-* backup (not destroyed)');
  assert(out.rewrote === 7, 'store stays writable after a corrupt load');
  console.log('✓ corrupt state.json → backed up, started empty, still writable');
}

// 2) A file that parses to a non-object (array) is rejected as corrupt, not adopted as the root.
{
  const out = run(
    'nonobject',
    (dir, fs, path) => { fs.writeFileSync(path.join(dir, 'state.json'), '[1,2,3]'); },
    (persist, dir, fs) => {
      const v = persist.ns('probe').v;
      const backups = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt-'));
      return { v, backups: backups.length };
    }
  );
  assert(out.v === undefined, 'array root rejected → started empty');
  assert(out.backups === 1, 'non-object root preserved as a .corrupt-* backup');
  console.log('✓ non-object root (array) → rejected + backed up, not adopted');
}

// 3) If state.json is missing but a COMPLETE state.json.tmp is left behind (crash between write-temp
//    and rename), recover the newest state from the tmp instead of starting empty.
{
  const out = run(
    'tmprecover',
    (dir, fs, path) => { fs.writeFileSync(path.join(dir, 'state.json.tmp'), JSON.stringify({ probe: { v: 42 } })); },
    (persist) => ({ v: persist.ns('probe').v })
  );
  assert(out.v === 42, 'recovered newest state from a leftover .tmp when state.json was missing');
  console.log('✓ missing state.json + valid .tmp → recovered from the interrupted write');
}

// 4) Sanity: a valid state.json loads normally (no false-positive backup).
{
  const out = run(
    'valid',
    (dir, fs, path) => { fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ probe: { v: 5 } })); },
    (persist, dir, fs) => ({ v: persist.ns('probe').v, backups: fs.readdirSync(dir).filter((f) => f.includes('corrupt')).length })
  );
  assert(out.v === 5, 'valid state.json loads its data');
  assert(out.backups === 0, 'a valid file is never backed up as corrupt');
  console.log('✓ valid state.json loads normally, no spurious backup');
}

console.log('\nPERSIST RECOVERY HARNESS PASSED');
