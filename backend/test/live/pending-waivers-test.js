'use strict';
// mflRepo.pendingWaivers — this franchise's queued (unprocessed) waiver requests. Pinned to a
// real sample: FAAB requests under pendingWaivers.blindBidWaiverRequest, addsDrops as a CSV of
// "add_bid_drop" tokens, carrying the waiver `round`. Also covers the FCFS ("add_drop") shape.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');

const league = { host: 'www45.myfantasyleague.com', leagueId: '69597', franchiseId: '0001' };

(async () => {
  // 1) FAAB — the exact sample shape.
  mfl.exportRequest = async (type) => {
    if (type !== 'pendingWaivers') return {};
    return { pendingWaivers: { blindBidWaiverRequest: { round: '1', timestamp: '1784766801', comments: '', addsDrops: '14080_0_14849,13133_0_14849' } } };
  };
  const faab = await mflRepo.pendingWaivers(league, 'ck');
  assert(faab.length === 1, `one pending FAAB request, got ${faab.length}`);
  const r = faab[0];
  assert(r.system === 'faab' && r.round === 1, `system+round parsed, got ${r.system}/${r.round}`);
  assert(r.timestamp === 1784766801, 'timestamp parsed');
  assert(r.picks.length === 2, `two picks, got ${r.picks.length}`);
  assert(r.picks[0].add === '14080' && r.picks[0].bid === 0 && r.picks[0].drop === '14849', `pick0 add_bid_drop, got ${JSON.stringify(r.picks[0])}`);
  assert(r.picks[1].add === '13133' && r.picks[1].drop === '14849', 'pick1 parsed');
  console.log('✓ FAAB pending: round=1, picks add_bid_drop parsed from addsDrops');

  // 2) FCFS — add_drop tokens under waiverRequest, and 0000 → no drop.
  mfl.exportRequest = async (type) => {
    if (type !== 'pendingWaivers') return {};
    return { pendingWaivers: { waiverRequest: { round: '3', addsDrops: '5000_6000,7000_0000' } } };
  };
  const fcfs = await mflRepo.pendingWaivers(league, 'ck');
  assert(fcfs.length === 1 && fcfs[0].system === 'fcfs' && fcfs[0].round === 3, 'FCFS request + round parsed');
  assert(fcfs[0].picks[0].add === '5000' && fcfs[0].picks[0].drop === '6000' && fcfs[0].picks[0].bid === null, 'FCFS pick add_drop (no bid)');
  assert(fcfs[0].picks[1].drop === null, '0000 drop slot → null');
  console.log('✓ FCFS pending: round=3, add_drop picks, 0000 → no drop');

  // 3) No pending requests → empty array (offseason / nothing queued).
  mfl.exportRequest = async () => ({ pendingWaivers: {} });
  const none = await mflRepo.pendingWaivers(league, 'ck');
  assert(Array.isArray(none) && none.length === 0, 'no pending requests → empty array');
  console.log('✓ empty pendingWaivers → []');

  console.log('\nPENDING WAIVERS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
