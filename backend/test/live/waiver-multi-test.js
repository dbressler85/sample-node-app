'use strict';
// Waiver multi-add: queue several claims in ONE league with FAAB budgeting AND roster
// space checked ACROSS the queue. A bid can fit alone yet the sum bust the budget; N adds
// on a near-full roster need N drops. Demo league 64097 is FAAB ($78 left), roster 11/12.
process.env.MFL_DEMO_MODE = 'true';

const waivers = require('../../src/services/waivers');
const demo = require('../../src/demo/fixtures');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const L = '64097';
  const fa = demo.freeAgents(L);
  const [a, b, c] = fa; // three distinct available ids
  const DROP1 = '11686';
  const DROP2 = '13138'; // two bench players to make room

  // Each bid fits alone ($50 < $78) but together they'd be $100 > $78 — caught by the
  // cross-claim budget check (plus roster space, since 11/12 + 2 adds needs 2 drops).
  let pv = await waivers.previewMulti('ck', 'tok', L, [{ addId: a, bid: 50 }, { addId: b, bid: 50 }]);
  console.log('over-budget:', JSON.stringify(pv.summary.errors));
  assert(!pv.summary.valid, 'queue that busts the budget is invalid');
  assert(pv.summary.errors.some((e) => /budget/i.test(e)), 'flags the total-bids-over-budget');
  assert(pv.summary.totalBid === 100 && pv.summary.budgetRemaining === 78, 'reports the total bid vs remaining budget');
  console.log('✓ FAAB budgeting across the queue: two individually-affordable bids that together bust the budget are blocked');

  // Roster space: 11/12 has ONE open spot, so two adds with no drops overflow by one.
  pv = await waivers.previewMulti('ck', 'tok', L, [{ addId: a, bid: 10 }, { addId: b, bid: 10 }]);
  console.log('roster-space:', JSON.stringify({ rosterAfter: pv.summary.rosterAfter, errors: pv.summary.errors }));
  assert(!pv.summary.valid && pv.summary.errors.some((e) => /roster spots/i.test(e)), 'not enough drops for the adds → invalid');
  assert(!pv.summary.errors.some((e) => /budget/i.test(e)), 'small bids are within budget — only the roster is the problem');
  console.log('✓ roster space across the queue: 2 adds into 1 open spot need a drop');

  // Duplicate add is caught.
  pv = await waivers.previewMulti('ck', 'tok', L, [{ addId: a, dropId: DROP1, bid: 10 }, { addId: a, dropId: DROP2, bid: 10 }]);
  assert(!pv.summary.valid && pv.summary.errors.some((e) => /add more than once/i.test(e)), 'duplicate add is caught');
  console.log('✓ duplicate add in the queue is rejected');

  // A valid queue: 2 adds + 1 drop fills the open spot (11 + 2 - 1 = 12), total $50 <= $78.
  const good = [{ addId: a, dropId: DROP1, bid: 20 }, { addId: b, bid: 30 }];
  pv = await waivers.previewMulti('ck', 'tok', L, good);
  console.log('valid queue summary:', JSON.stringify(pv.summary));
  assert(pv.summary.valid, 'a within-budget, roster-legal queue is valid');
  assert(pv.summary.budgetAfter === 28, 'budget-after = 78 - 50');
  assert(pv.summary.rosterAfter === 12 && pv.summary.rosterAfter <= pv.summary.rosterSize, 'roster stays within size');

  const res = await waivers.submitMulti('ck', 'tok', L, good);
  console.log('submit:', JSON.stringify({ requested: res.summary.requested, submitted: res.summary.submitted, totalBid: res.summary.totalBid, budgetAfter: res.summary.budgetAfter }));
  assert(res.summary.requested === 2 && res.summary.submitted === 2, 'both claims submitted');
  assert(res.results.every((r) => r.ok && r.claim), 'each claim stored');
  console.log('✓ submitMulti: the whole validated queue is submitted (FAAB order preserved)');

  console.log('\nWAIVER MULTI-ADD HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
