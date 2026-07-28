'use strict';
// League age frame-of-reference. The raw "core 25.8y" number carried no scale — good or bad? — so
// leagueAgeContext ranks my team's production-weighted core age against every franchise (1 = youngest)
// and reports the league averages. This proves: (1) the youngest core ranks 1st and the oldest last;
// (2) ties share the better (lower) rank; (3) the league averages are the mean across teams; and
// (4) a sub-2-team / unreadable league returns null (the app then shows the bare numbers).
const roster = require('../../src/services/roster');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// A tiny fake enrichment snapshot: value/age/winNow keyed by player id. Ages chosen so each
// franchise's top-5-by-winNow core age is obvious.
const P = {
  // team A — young core (~23)
  a1: { v: 90, age: 23, wn: 90 }, a2: { v: 80, age: 22, wn: 80 }, a3: { v: 70, age: 24, wn: 70 }, a4: { v: 60, age: 23, wn: 60 }, a5: { v: 50, age: 23, wn: 50 },
  // team B — veteran core (~29)
  b1: { v: 90, age: 30, wn: 90 }, b2: { v: 80, age: 29, wn: 80 }, b3: { v: 70, age: 28, wn: 70 }, b4: { v: 60, age: 29, wn: 60 }, b5: { v: 50, age: 29, wn: 50 },
  // team C — middle core (~26), a copy so we can force a tie with D
  c1: { v: 90, age: 26, wn: 90 }, c2: { v: 80, age: 26, wn: 80 }, c3: { v: 70, age: 26, wn: 70 }, c4: { v: 60, age: 26, wn: 60 }, c5: { v: 50, age: 26, wn: 50 },
  d1: { v: 90, age: 26, wn: 90 }, d2: { v: 80, age: 26, wn: 80 }, d3: { v: 70, age: 26, wn: 70 }, d4: { v: 60, age: 26, wn: 60 }, d5: { v: 50, age: 26, wn: 50 },
};
const enr = {
  value: (id) => (P[id] ? P[id].v : null),
  age: (id) => (P[id] ? P[id].age : null),
  winNow: (id) => (P[id] ? P[id].wn : null),
};
const fr = (id, keys) => ({ id, player: keys.map((k) => ({ id: k })) });
const franchises = [
  fr('A', ['a1', 'a2', 'a3', 'a4', 'a5']),
  fr('B', ['b1', 'b2', 'b3', 'b4', 'b5']),
  fr('C', ['c1', 'c2', 'c3', 'c4', 'c5']),
  fr('D', ['d1', 'd2', 'd3', 'd4', 'd5']),
];

// 1) youngest core (A) ranks 1st of 4; oldest (B) ranks last.
const a = roster.leagueAgeContext(franchises, 'A', enr);
assert(a && a.coreRank === 1 && a.teams === 4, `youngest core → 1st of 4, got ${JSON.stringify(a)}`);
const b = roster.leagueAgeContext(franchises, 'B', enr);
assert(b.coreRank === 4, `oldest core → 4th of 4, got rank ${b.coreRank}`);
console.log(`✓ youngest core ranks 1st (${a.coreRank}/${a.teams}), oldest ranks last (${b.coreRank}/${b.teams})`);

// 2) C and D have identical core age (26) → they SHARE the same rank (strict-younger + 1). A(23) is
// younger than both, so C and D both rank 2nd.
const c = roster.leagueAgeContext(franchises, 'C', enr);
const d = roster.leagueAgeContext(franchises, 'D', enr);
assert(c.coreRank === 2 && d.coreRank === 2, `tied cores share rank 2, got C=${c.coreRank} D=${d.coreRank}`);
console.log(`✓ tied core ages share the better rank (C and D both ${c.coreRank}nd)`);

// 3) league averages are the mean across teams: cores ≈ (23.0 + 29.0 + 26.0 + 26.0)/4 = 26.0.
assert(Math.abs(a.leagueCoreAge - 26.0) < 0.15, `league avg core ≈ 26.0, got ${a.leagueCoreAge}`);
assert(a.leagueAvgAge != null, 'league average age is reported');
console.log(`✓ league averages reported (core ${a.leagueCoreAge}y, avg ${a.leagueAvgAge}y)`);

// 4) fewer than two franchises → null (the app falls back to the bare numbers).
assert(roster.leagueAgeContext([fr('A', ['a1', 'a2'])], 'A', enr) === null, 'single-franchise league → null context');
assert(roster.leagueAgeContext(null, 'A', enr) === null, 'no franchises → null context');
console.log('✓ falls back to null when the whole league is not visible');

console.log('\nAGE CONTEXT HARNESS PASSED');
