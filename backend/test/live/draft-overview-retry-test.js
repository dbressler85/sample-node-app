'use strict';
// A transient MFL throttle on ONE league's draftResults during the Home/overview fan-out must NOT
// hide that league's live draft (it used to be swallowed as status 'none'). getOverview retries the
// transient read, so the draft still shows. Regression guard for "a live draft missing from Home."
process.env.MFL_DEMO_MODE = 'false';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-draftretry-${process.pid}-${Date.now()}`);

const mfl = require('../../src/lib/mfl');

// Fail the FIRST draftResults read (simulate a 403/429 throttle mid-fan-out), then succeed.
let draftResultsCalls = 0;
mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Dynasty', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'draftResults':
      draftResultsCalls += 1;
      if (draftResultsCalls === 1) { const e = new Error('MFL 429 (throttled)'); throw e; }
      return { draftResults: { draftUnit: [{ unit: 'LEAGUE', draftPick: [
        { round: '1', pick: '1', franchise: '0002', player: '20' },
        { round: '1', pick: '2', franchise: '0001', player: '' }, // me — on the clock (draft is LIVE)
        { round: '2', pick: '1', franchise: '0001', player: '' },
        { round: '2', pick: '2', franchise: '0002', player: '' },
      ] }] } };
    case 'calendar':
      return {}; // no DRAFT_START event — a real pick alone proves the draft is live
    case 'league':
      return { league: { draftLimitHours: '4' } };
    default:
      return {};
  }
};

const draft = require('../../src/services/draft');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const ov = await draft.getOverview('ck', 'tk');
  const d = ov.drafts[0];
  console.log('overview after a one-time throttle:', JSON.stringify({ status: d.status, myOnClock: d.myOnClock, calls: draftResultsCalls, live: ov.summary.live }));
  assert(draftResultsCalls >= 2, `the transient read was retried, got ${draftResultsCalls} call(s)`);
  assert(d.status === 'in_progress', `live draft still shows as in_progress despite the throttle, got '${d.status}'`);
  assert(d.myOnClock === true, 'still detects I am on the clock');
  assert(ov.summary.live === 1, 'summary counts the live draft');
  console.log('✓ a transient throttle on one league no longer hides its live draft from Home');
  console.log('\nDRAFT OVERVIEW RETRY PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
