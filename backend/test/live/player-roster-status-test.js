'use strict';
// mflRepo.playerRosterStatus — authoritative per-player league status. Pinned to a real
// playerRosterStatus sample (rostered starters + an errored id) plus the doc's free-agent
// variants (is_fa / locked / cant_add) and a multi-copy roster_franchise array.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');

let sentP = null;
mfl.exportRequest = async (type, opts = {}) => {
  if (type !== 'playerRosterStatus') return {};
  sentP = opts.P;
  return { playerRosterStatuses: { playerStatus: [
    { id: '13130', roster_franchise: { franchise_id: '0008', status: 'S' } }, // rostered (real sample)
    { id: '14836', roster_franchise: { franchise_id: '0012', status: 'S' } }, // rostered (real sample)
    { id: '12606', error: 'Invalid Position' },                               // bad id (real sample)
    { id: '500', is_fa: '1' },                                                // free agent, addable
    { id: '501', is_fa: '1', locked: '1' },                                   // free but locked
    { id: '502', is_fa: '1', cant_add: '1' },                                 // free but can't add
    { id: '600', roster_franchise: [{ franchise_id: '0003', status: 'S' }, { franchise_id: '0009', status: 'TS' }] }, // multi-copy
  ] } };
};

const league = { host: 'www45.myfantasyleague.com', leagueId: '69597', franchiseId: '0001' };

(async () => {
  const list = await mflRepo.playerRosterStatus(league, 'ck', ['13130', '14836', '12606']);
  assert(sentP === '13130,14836,12606', `P sent as CSV, got ${sentP}`);
  const by = new Map(list.map((s) => [s.id, s]));

  // Rostered starter → owner + slot, not a free agent.
  assert(by.get('13130').franchises[0].franchiseId === '0008' && by.get('13130').franchises[0].status === 'S', 'rostered owner+status parsed');
  assert(by.get('13130').isFreeAgent === false, 'rostered player is not a free agent');

  // Errored id surfaces the error, no franchises.
  assert(by.get('12606').error === 'Invalid Position' && by.get('12606').franchises.length === 0, 'errored id parsed');

  // Free-agent variants.
  assert(by.get('500').isFreeAgent === true && !by.get('500').locked && !by.get('500').cantAdd, 'plain FA parsed');
  assert(by.get('501').locked === true, 'locked FA parsed');
  assert(by.get('502').cantAdd === true, "can't-add FA parsed");

  // Multi-copy league: roster_franchise as an array → both owners.
  assert(by.get('600').franchises.length === 2 && by.get('600').franchises[1].status === 'TS', 'multi-copy roster_franchise array handled');
  console.log('✓ playerRosterStatus: rostered / free / locked / cant_add / errored / multi-copy all normalized');

  // Eligibility interpretation.
  assert(mflRepo.addEligibility(by.get('500')).addable === true, 'plain FA is addable');
  assert(mflRepo.addEligibility(by.get('13130')).addable === false, 'rostered player not addable');
  assert(/locked/i.test(mflRepo.addEligibility(by.get('501')).reason), 'locked reason surfaced');
  assert(/Invalid Position/.test(mflRepo.addEligibility(by.get('12606')).reason), 'error reason surfaced');
  console.log('✓ addEligibility: FA addable, rostered/locked/errored blocked with a reason');

  console.log('\nPLAYER ROSTER STATUS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
