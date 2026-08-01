'use strict';

// The construction verdict must flag a deal that OPENS a hole, not just one that deals
// from a pre-existing need. Classic case: you roster exactly one startable RB. RB isn't a
// "need" (your starter is fine), but sending him leaves you with none — that has to read
// as a caution. And it must NOT fire when you're backfilled or when you shed a scrub.

const { constructionVerdict, needsSurplus, suggestGive } = require('../../src/lib/tradefit');
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

  // 5) Kicker/defense are streamers, NOT trade pieces: excluded from needs/surplus (even in a
  // DEF-start league) and never proposed in a suggested package.
  const reqs = [
    { name: 'QB', eligible: ['QB'], count: 1 },
    { name: 'DEF', eligible: ['DEF'], count: 1 },
  ];
  const ns = needsSurplus(
    [
      { franchiseId: '1', players: [{ id: 'a', position: 'QB', value: 60 }, { id: 'b', position: 'DEF', value: 2 }] },
      { franchiseId: '2', players: [{ id: 'c', position: 'QB', value: 60 }] }, // no DEF, but DEF isn't a trade need
    ],
    reqs
  );
  assert(!ns['2'].needs.some((n) => n.pos === 'DEF'), `DEF is never a trade need (streamer), got ${JSON.stringify(ns['2'].needs)}`);
  // The suggester must never put a kicker or defense in the give package.
  const give = suggestGive(
    [{ id: 'd', name: 'A Defense', position: 'DEF', value: 2 }, { id: 'w', name: 'A WR', position: 'WR', value: 50 }],
    50,
    [],
    new Set()
  );
  assert(give.every((p) => !['PK', 'DEF'].includes(p.position)), `suggested give never includes K/DEF, got ${JSON.stringify(give.map((g) => g.position))}`);
  assert(give.length === 1 && give[0].id === 'w', 'the fair WR is suggested, not the defense');
  console.log('✓ K/DEF are streamers: never a trade need, never in a suggested package');

  // 6) Re-tuned "startable" bar (needsSurplus depth): a productive VET with a low DYNASTY value still
  // counts as a startable body — dynasty value age-discounts vets, startability shouldn't. So trading
  // your top TE while keeping the vet must NOT read as a phantom "no startable TE" hole. The floor is
  // the league POSITIONAL tier (starting jobs + a buffer), not 60% of the best-TE median.
  const teReqs = [{ name: 'TE', eligible: ['TE'], count: 1 }];
  const teFranchises = [
    { franchiseId: '1', players: [{ id: 'kittle', position: 'TE', value: 60 }, { id: 'goedert', position: 'TE', value: 22 }] },
    { franchiseId: '2', players: [{ id: 't2a', position: 'TE', value: 50 }, { id: 't2b', position: 'TE', value: 15 }] },
    { franchiseId: '3', players: [{ id: 't3a', position: 'TE', value: 45 }, { id: 't3b', position: 'TE', value: 10 }] },
    { franchiseId: '4', players: [{ id: 't4a', position: 'TE', value: 30 }] },
  ];
  const teNs = needsSurplus(teFranchises, teReqs);
  const myTE = teNs['1'].depth.TE;
  console.log('vet TE depth:', JSON.stringify(myTE));
  // Under the OLD 60%-of-median-starter bar the 22-value vet fell below the cut (startable would be 1);
  // the positional-tier floor now counts him, so both my TEs are startable.
  assert(myTE.startable >= 2, `a low-value vet TE still counts as startable, got startable=${myTE.startable} (threshold ${myTE.threshold})`);
  const teHole = constructionVerdict([{ position: 'TE', value: 60 }], [{ position: 'RB', value: 55 }], teNs['1'].needs, teNs['1'].surplus, 'you', teNs['1'].depth);
  console.log('trade-top-TE-keep-vet:', JSON.stringify(teHole));
  assert(!teHole.holes.includes('TE'), 'trading your top TE while keeping a startable vet is NOT a no-startable-TE hole');
  console.log('✓ startable bar counts low-value vets — no phantom "no startable TE" when a vet remains');

  // 7) The reported bug: a retained TE our value source (FantasyCalc) can't price (value: null) was
  // dropped from the position entirely, so giving a VALUED TE read as "strips their TE starter" even
  // though a real body stayed. `bodies` now counts unvalued rosters, so it's roster-neutral, not a hole.
  const nullReqs = [{ name: 'TE', eligible: ['TE'], count: 1 }];
  const nullFranchises = [
    { franchiseId: '1', players: [{ id: 'keep', position: 'TE', value: null }, { id: 'give', position: 'TE', value: 45 }] },
    { franchiseId: '2', players: [{ id: 't2', position: 'TE', value: 50 }, { id: 't2b', position: 'TE', value: 30 }] },
    { franchiseId: '3', players: [{ id: 't3', position: 'TE', value: 40 }] },
  ];
  const nullNs = needsSurplus(nullFranchises, nullReqs);
  assert(nullNs['1'].depth.TE.bodies === 2, `an unvalued rostered TE still counts as a body, got ${JSON.stringify(nullNs['1'].depth.TE)}`);
  const nullHole = constructionVerdict([{ position: 'TE', value: 45 }], [{ position: 'RB', value: 55 }], nullNs['1'].needs, nullNs['1'].surplus, 'they', nullNs['1'].depth);
  assert(!nullHole.holes.includes('TE'), `keeping an unvalued TE is NOT a "strips their starter" hole, got ${JSON.stringify(nullHole)}`);
  // ...but a team with only ONE TE that gives him away IS a genuine hole (the slot truly empties).
  const emptyNs = needsSurplus([{ franchiseId: '1', players: [{ id: 'give', position: 'TE', value: 45 }] }, ...nullFranchises.slice(1)], nullReqs);
  const emptyHole = constructionVerdict([{ position: 'TE', value: 45 }], [{ position: 'RB', value: 55 }], emptyNs['1'].needs, emptyNs['1'].surplus, 'they', emptyNs['1'].depth);
  assert(emptyHole.holes.includes('TE'), 'giving away your ONLY TE still flags a real hole');
  console.log('✓ an unvalued retained body prevents a false "strips their starter"; a truly emptied slot still flags');

  // 8) The REAL reported bug: in a SUPERFLEX + FLEX lineup, TE's fractional flex/superflex share
  // (1 + 1/3 + 1/4 = 1.58) rounded to 2 "required" TE starters, so trading a team's 2nd TE (value 14)
  // while they KEPT a better one (value 20) read as "strips their TE starter". Hole detection now uses
  // DEDICATED slots (a flex/SF slot doesn't force a TE), so only 1 TE is required → no hole, and the
  // per-team starter read is the best TE (20), not a top-2 average — so it's roster-neutral, not "thin".
  const sfReqs = [
    { name: 'QB', eligible: ['QB'], count: 1 }, { name: 'RB', eligible: ['RB'], count: 2 },
    { name: 'WR', eligible: ['WR'], count: 2 }, { name: 'TE', eligible: ['TE'], count: 1 },
    { name: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 }, { name: 'SUPERFLEX', eligible: ['QB', 'RB', 'WR', 'TE'], count: 1 },
  ];
  const rb = (n, base) => Array.from({ length: n }, (_, i) => ({ id: `rb${base}${i}`, position: 'RB', value: base - i }));
  const sfFranchises = [
    { franchiseId: '1', players: [...rb(8, 80, 1), { id: 'keep', position: 'TE', value: 20 }, { id: 'give', position: 'TE', value: 14 }] },
    ...Array.from({ length: 10 }, (_, i) => ({ franchiseId: `T${i}`, players: [...rb(8, 75 - i), { id: `te${i}`, position: 'TE', value: 30 - i * 2 }] })),
  ];
  const sfNs = needsSurplus(sfFranchises, sfReqs);
  assert(sfNs['1'].depth.TE.slots === 1, `superflex+flex: TE requires only its DEDICATED slot (1), got ${sfNs['1'].depth.TE.slots}`);
  const sfV = constructionVerdict([{ position: 'TE', value: 14 }], [{ position: 'RB', value: 70 }], sfNs['1'].needs, sfNs['1'].surplus, 'they', sfNs['1'].depth);
  assert(!sfV.holes.includes('TE'), `trading the 2nd TE while keeping a better one is NOT a hole in a 1-TE lineup, got ${JSON.stringify(sfV)}`);
  assert(sfV.rating !== 'caution', `and it should not read as a caution/"tough sell", got ${sfV.rating}: ${sfV.reason}`);
  console.log('✓ superflex+flex no longer over-requires 2 TEs — trading a kept-a-better-one backup TE is roster-neutral');

  // 9) The REPORTED bug (a "FLEXY" league with flexible position limits): MFL lets a slot carry a RANGE
  // ("1-3 TE") — you're FORCED to start 1 but MAY start up to 3, and `count` is the max. Hole detection
  // summed `count` (the max), so a 1-3 TE slot read as REQUIRING 3 TEs — trading one of three rostered
  // TEs left two < three and fired "Leaves you with no startable TE — don't do it", even with all three
  // on the active roster. Dedicated slots now use the forced MINIMUM, so only 1 TE is required.
  const flexReqs = [
    { name: 'QB', eligible: ['QB'], count: 2, min: 2, max: 2 },
    { name: 'RB', eligible: ['RB'], count: 4, min: 1, max: 4 }, // flexible: forced 1, up to 4
    { name: 'TE', eligible: ['TE'], count: 3, min: 1, max: 3 }, // "1-3 TE" — forced 1, up to 3
  ];
  const flexFranchises = [
    // Me: three real TEs on the ACTIVE roster (an elite, a vet, a rookie) — none stashed.
    { franchiseId: '1', players: [{ id: 'bowers', position: 'TE', value: 62 }, { id: 'andrews', position: 'TE', value: 15 }, { id: 'siddiq', position: 'TE', value: 8 }] },
    { franchiseId: '2', players: [{ id: 't2a', position: 'TE', value: 40 }, { id: 't2b', position: 'TE', value: 12 }] },
    { franchiseId: '3', players: [{ id: 't3a', position: 'TE', value: 30 }] },
    { franchiseId: '4', players: [{ id: 't4a', position: 'TE', value: 20 }] },
  ];
  const flexNs = needsSurplus(flexFranchises, flexReqs);
  assert(flexNs['1'].depth.TE.slots === 1, `a "1-3 TE" range forces only 1 TE, not 3 — got slots=${flexNs['1'].depth.TE.slots}`);
  assert(flexNs['1'].depth.TE.bodies === 3, `all three active TEs count as bodies, got ${flexNs['1'].depth.TE.bodies}`);
  const flexHole = constructionVerdict(
    [{ position: 'TE', value: 15 }, { position: 'PICK', value: 8 }], // give Andrews + a pick
    [{ position: 'PICK', value: 22 }], // for a 1st
    flexNs['1'].needs, flexNs['1'].surplus, 'you', flexNs['1'].depth
  );
  console.log('flexy-league trade-one-of-three-TEs:', JSON.stringify(flexHole));
  assert(!flexHole.holes.includes('TE'), 'trading one of three rostered TEs in a 1-3 TE league is NOT a hole');
  assert(flexHole.rating !== 'caution' || !/no startable TE/i.test(flexHole.reason || ''), 'no false "no startable TE" caution');
  console.log('✓ flexible position limits ("1-3 TE") no longer over-require the MAX — trading one of three TEs is safe');

  console.log('\nTRADE HOLE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
