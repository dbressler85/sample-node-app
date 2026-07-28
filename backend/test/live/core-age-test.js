'use strict';
// Production-weighted core age. "Core age" (the aging axis of team outlook) used the five most
// VALUABLE players — but dynasty value is age-discounted, so a productive 30-year-old sinks below a
// younger bench asset and drops out of the average, making aging teams read younger than they play.
// coreAgeOf now ranks the core by win-now (redraft) value, which tracks this-season role and isn't
// age-penalized. This proves: (1) an aging on-field stud stays in the core, raising the age to what
// the team actually fields; (2) it falls back to dynasty value when win-now is absent (old behavior);
// (3) a genuinely young team is unaffected.
const roster = require('../../src/services/roster');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const round1 = (n) => Math.round(n * 10) / 10;

// Five young dynasty studs (top-5 by VALUE) plus aging producers whose value is age-discounted but
// whose win-now value is elite (they carry the team on the field).
const team = [
  { age: 23, value: 95, winNow: 30 },
  { age: 24, value: 90, winNow: 28 },
  { age: 22, value: 88, winNow: 22 },
  { age: 23, value: 84, winNow: 25 },
  { age: 25, value: 80, winNow: 26 },
  { age: 32, value: 45, winNow: 99 },
  { age: 31, value: 42, winNow: 95 },
  { age: 30, value: 40, winNow: 92 },
];

// 1) production-weighted vs the old value-only read.
const prod = roster.coreAgeOf(team);
const valueOnly = round1([...team].sort((a, b) => b.value - a.value).slice(0, 5).reduce((s, p) => s + p.age, 0) / 5);
console.log({ productionWeighted: prod, oldValueOnly: valueOnly });
assert(prod > valueOnly, `production weighting reads OLDER than value-only (${prod} > ${valueOnly})`);
assert(prod >= 28, `aging on-field studs pull the core age up to what's actually fielded (got ${prod})`);
console.log('✓ aging producers stay in the core → the team reads the age it plays, not an age-discounted illusion');

// 2) fallback: no win-now anywhere → identical to the old value-only read.
const noWin = team.map((p) => ({ age: p.age, value: p.value }));
assert(roster.coreAgeOf(noWin) === valueOnly, `falls back to value-only when win-now is absent (got ${roster.coreAgeOf(noWin)}, want ${valueOnly})`);
console.log('✓ falls back to the value-only core when no player carries a win-now value');

// 3) a genuinely young team (young players ARE the producers) is unaffected — still young.
const young = [
  { age: 22, value: 95, winNow: 95 },
  { age: 23, value: 90, winNow: 90 },
  { age: 21, value: 88, winNow: 85 },
  { age: 24, value: 84, winNow: 80 },
  { age: 22, value: 80, winNow: 78 },
  { age: 30, value: 30, winNow: 25 },
];
assert(roster.coreAgeOf(young) <= 24.5, `a genuinely young team stays young (got ${roster.coreAgeOf(young)})`);
console.log('✓ a genuinely young production core still reads young');

console.log('\nCORE AGE HARNESS PASSED');
