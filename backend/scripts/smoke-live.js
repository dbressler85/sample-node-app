'use strict';

// Live-path regression suite. The demo smoke (scripts/smoke.js) exercises DEMO
// mode; these harnesses drive the LIVE code paths (MyFantasyLeague + FantasyCalc/
// Sleeper) against stubbed responses — the only automated coverage for live logic
// (matchup projection, enrichment crosswalk, format-aware values, trades, drafts,
// the offseason Home pivot, and the player hub). Each test monkeypatches modules
// and process.env, so they must run as isolated child processes.
// Run: npm run smoke:live   (exits non-zero on any failure)

const { spawnSync } = require('child_process');
const path = require('path');

const fs = require('fs');
// Self-registering: every test/live/*-test.js runs. No hand-maintained list to drift out of
// sync with the directory (a forgotten registration used to mean a harness silently never ran).
const TESTS = fs.readdirSync(path.join(__dirname, '..', 'test', 'live'))
  .filter((f) => f.endsWith('-test.js'))
  .map((f) => f.replace(/\.js$/, ''))
  .sort();

let failed = 0;
for (const t of TESTS) {
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'test', 'live', `${t}.js`)], { encoding: 'utf8' });
  const ok = res.status === 0;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? '✓' : '✗'} ${t}\n`);
  if (!ok) process.stdout.write((res.stdout || '') + (res.stderr || '') + '\n');
}

process.stdout.write(`\n${TESTS.length - failed}/${TESTS.length} live checks passed\n`);
process.exit(failed ? 1 : 0);
