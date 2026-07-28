'use strict';
// Standings-aware team outlook. computeOutlook blended roster strength + core age, so a stacked
// veteran roster sitting at the bottom of the standings still read "Win-now window." Folding in the
// actual season record fixes that. This proves: (1) a strong+veteran roster that's LOSING drops from
// Win-now to Balanced; (2) the same roster while WINNING stays Win-now; (3) a middling roster on a
// top-third record is promoted to Win-now; (4) with no record (preseason/unreadable) it falls back to
// the exact roster-only read; and (5) recordPctByFranchise ranks by win% (ties = ½), pf-tiebroken.
const roster = require('../../src/services/roster');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const OLD = 27;   // veteran core
const YOUNG = 23; // young core
const STRONG = 0.9, MID = 0.5, WEAK = 0.2;

// 1) strong + veteran, but out of it (bottom third) → Balanced, not Win-now.
assert(roster.computeOutlook(OLD, STRONG, 0.1) === 'Balanced', `stacked-but-losing → Balanced, got ${roster.computeOutlook(OLD, STRONG, 0.1)}`);
// 2) same roster, winning → Win-now window.
assert(roster.computeOutlook(OLD, STRONG, 0.9) === 'Win-now window', `stacked + winning → Win-now, got ${roster.computeOutlook(OLD, STRONG, 0.9)}`);
console.log('✓ a stacked veteran roster reads Win-now when winning but Balanced when the season is lost');

// 3) middling roster on a top-third record → promoted to Win-now; a .500 record does NOT promote.
assert(roster.computeOutlook(OLD, MID, 0.8) === 'Win-now window', `middling + hot record → Win-now, got ${roster.computeOutlook(OLD, MID, 0.8)}`);
assert(roster.computeOutlook(OLD, MID, 0.5) === 'Balanced', `middling + .500 record stays Balanced, got ${roster.computeOutlook(OLD, MID, 0.5)}`);
console.log('✓ a middling roster is promoted to Win-now only on a genuinely contending (top-third) record');

// 4) no record → identical to the roster-only read (nothing regresses without standings).
assert(roster.computeOutlook(OLD, STRONG) === 'Win-now window', 'strong+old, no record → Win-now (unchanged)');
assert(roster.computeOutlook(OLD, STRONG, null) === 'Win-now window', 'strong+old, null record → Win-now (unchanged)');
assert(roster.computeOutlook(YOUNG, MID, null) === 'Ascending', 'young+mid, null record → Ascending (unchanged)');
assert(roster.computeOutlook(OLD, WEAK, 0.9) === 'Rebuilding', 'weak roster stays Rebuilding regardless of a hot record');
console.log('✓ falls back to the exact roster-only read when there is no record');

// 5) recordPctByFranchise: rank by win% (ties = ½ a win), points-for as the tiebreak; preseason empty.
const m = roster.recordPctByFranchise([
  { id: 'A', h2hw: 8, h2hl: 2, pf: 1200 },
  { id: 'B', h2hw: 5, h2hl: 5, pf: 1100 },
  { id: 'C', h2hw: 5, h2hl: 5, pf: 1300 }, // same record as B, more points → ranks above B
  { id: 'D', h2hw: 1, h2hl: 9, pf: 900 },
]);
assert(m.get('A') === 1, `best record = 1.0, got ${m.get('A')}`);
assert(m.get('C') > m.get('B'), `points-for breaks the B/C tie (C ${m.get('C')} > B ${m.get('B')})`);
assert(m.get('D') === 0.25, `worst record = 1/4, got ${m.get('D')}`);
assert(roster.recordPctByFranchise([{ id: 'A', h2hw: 0, h2hl: 0 }, { id: 'B', h2hw: 0, h2hl: 0 }]).size === 0, 'preseason (0 games played) → empty map');
console.log('✓ recordPctByFranchise ranks by win% with a points-for tiebreak, and is empty in the preseason');

// 6) recordForFranchise: the raw W-L for one team (drives the trade-block "you're 2-8" context), null
// for a missing team or the preseason.
const rec = roster.recordForFranchise([{ id: '0003', h2hw: 2, h2hl: 8, h2ht: 1, pf: 900 }, { id: '0004', h2hw: 8, h2hl: 3, pf: 1300 }], '0003');
assert(rec && rec.wins === 2 && rec.losses === 8 && rec.ties === 1, `raw record for a franchise (2-8-1), got ${JSON.stringify(rec)}`);
assert(roster.recordForFranchise([{ id: '0003', h2hw: 2, h2hl: 8 }], '9999') === null, 'a missing franchise → null record');
assert(roster.recordForFranchise([{ id: '0003', h2hw: 0, h2hl: 0 }], '0003') === null, 'preseason (0 games) → null record');
console.log('✓ recordForFranchise returns raw W-L (null when the team is missing or no games played)');

console.log('\nOUTLOOK RECORD HARNESS PASSED');
