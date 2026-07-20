'use strict';

// The construction verdict must flag a deal that OPENS a hole, not just one that deals
// from a pre-existing need. Classic case: you roster exactly one startable RB. RB isn't a
// "need" (your starter is fine), but sending him leaves you with none — that has to read
// as a caution. And it must NOT fire when you're backfilled or when you shed a scrub.

const { constructionVerdict } = require('../../src/lib/tradefit');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// You start 1 RB and hold exactly one startable RB (value 60, above the 40 bar).
const depth = {
  RB: { slots: 1, threshold: 40, startable: 1 },
  WR: { slots: 2, threshold: 40, startable: 3 },
};
const myRB = { position: 'RB', value: 60 };
const benchRB = { position: 'RB', value: 20 }; // below the startable bar
const aWR = { position: 'WR', value: 65 };
const anotherRB = { position: 'RB', value: 55 };

(async () => {
  // 1) Send your only startable RB for a WR — creates a hole even though RB wasn't a need.
  const v1 = constructionVerdict([myRB], [aWR], [], [], 'you', depth);
  console.log('only-RB-out:', JSON.stringify(v1));
  assert(v1.rating === 'caution', 'trading your only startable RB is a caution');
  assert(v1.holes.includes('RB'), 'the hole is reported at RB');
  assert(/startable RB/i.test(v1.reason), 'the reason names the hole it opens');

  // 2) Backfilled: give RB, get a startable RB — no hole (you can still field one).
  const v2 = constructionVerdict([myRB], [anotherRB], [], [], 'you', depth);
  console.log('RB-for-RB:', JSON.stringify(v2));
  assert(!v2.holes.includes('RB'), 'a startable RB coming back fills the spot — no hole');

  // 3) Shedding a bench scrub below the startable bar never invents a hole.
  const v3 = constructionVerdict([benchRB], [aWR], [], [], 'you', depth);
  console.log('scrub-out:', JSON.stringify(v3));
  assert(!v3.holes.includes('RB'), 'dealing a non-startable RB opens no hole');

  // 4) The partner-side phrasing describes their loss, not yours.
  const v4 = constructionVerdict([myRB], [aWR], [], [], 'they', depth);
  assert(v4.holes.includes('RB') && /their/i.test(v4.reason), 'partner-side hole reads as their loss');

  console.log('✓ hole detection: opens-a-hole caution, backfill clears it, scrubs are safe');
  console.log('\nTRADE HOLE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
