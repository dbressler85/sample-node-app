'use strict';
// Bug-report service: validates the note (empty → 400), and with no transport configured it accepts the
// report and PERSISTS it (delivered:false) so nothing is lost. The destination address is never in the
// response. Runs in demo mode with a temp DATA_DIR so the persist fallback is isolated.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-bugreport-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'true';
// Ensure no transport is configured for this harness so we exercise the persist fallback deterministically.
delete process.env.BUG_REPORT_WEBHOOK;
delete process.env.BUG_SMTP_URL;
delete process.env.BUG_REPORT_TO;

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const bugReport = require('../../src/services/bugReport');
const store = require('../../src/store/bugReports');
const TK = 'tok-bug-1';

(async () => {
  // Empty description → 400.
  let threw = false;
  try { await bugReport.submit(TK, 'ghosts', { message: '   ' }); } catch (e) { threw = e.status === 400; }
  assert(threw, 'empty message rejected with 400');

  // A real report → accepted, not delivered (no transport), and persisted with the note + diagnostics.
  const res = await bugReport.submit(TK, 'ghosts', { message: 'The donut loaded from zero.', diagnostics: { app: { version: '1.2.3' }, state: { screen: 'home' } } });
  assert(res.ok === true && res.delivered === false, `submit returns ok + not-delivered: ${JSON.stringify(res)}`);
  assert(res.to === undefined && res.email === undefined, 'response never reveals a destination address');

  const stored = store.list(TK);
  assert(stored.length === 1, `report persisted as fallback, got ${stored.length}`);
  assert(stored[0].message === 'The donut loaded from zero.' && stored[0].username === 'ghosts', 'stored report keeps message + username');
  assert(stored[0].diagnostics && stored[0].diagnostics.app.version === '1.2.3', 'stored report keeps diagnostics');
  console.log('✓ bug report: validates, persists when undeliverable, hides the destination');

  console.log('\nBUG-REPORT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
