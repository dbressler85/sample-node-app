'use strict';
// Prior-season card robustness. The player profile's "last season" card used to vanish when the
// owner's FIRST league had no prior-year fantasy total for the player (a new/redraft league, or a
// player who was unrostered there) AND the Sleeper box was absent. Now points are DERIVED from the
// real box score (league-independent) as a standard-PPR total, so the card populates far more often.
// This proves the derivation math: a WR/RB receiving/rushing line and a QB passing line both compute
// to the expected standard-PPR total, and an empty box yields null (→ the card's empty state).
process.env.MFL_DEMO_MODE = 'false';
const hub = require('../../src/services/playerhub');
const ppr = hub._pprPointsFromBox;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const approx = (a, b) => Math.abs(a - b) < 0.05;

// A WR: 90 rec, 1200 yds, 8 TD → 90 (rec) + 120 (yds×0.1) + 48 (8×6) = 258.0
const wr = ppr({ receiving: { rec: 90, yds: 1200, td: 8 } });
assert(approx(wr, 258), `WR PPR total = 258, got ${wr}`);
console.log(`✓ WR receiving line → ${wr} PPR pts (rec + 0.1/yd + 6/TD)`);

// An RB: 250 rush yds+TDs plus catches → 250×0.1 + 3×6 + (40 rec + 300×0.1 + 2×6) = 25+18+40+30+12 = 125.0
const rb = ppr({ rushing: { yds: 250, td: 3 }, receiving: { rec: 40, yds: 300, td: 2 } });
assert(approx(rb, 125), `RB PPR total = 125, got ${rb}`);
console.log(`✓ RB rushing+receiving line → ${rb} PPR pts`);

// A QB: 4000 pass yds, 30 TD, 10 INT + a little rushing → 160 + 120 - 10 + (200×0.1 + 2×6) = 270 + 32 = 302.0
const qb = ppr({ passing: { yds: 4000, td: 30, int: 10 }, rushing: { yds: 200, td: 2 } });
assert(approx(qb, 302), `QB PPR total = 302, got ${qb}`);
console.log(`✓ QB passing+rushing line → ${qb} PPR pts (0.04/yd + 4/passTD − 1/INT)`);

// An empty box (games played only, no scoring events) → null, so the caller shows the empty-state card.
assert(ppr({ gp: 5 }) === null, 'a box with no scoring events derives null');
assert(ppr(null) === null, 'a null box derives null');
console.log('✓ an empty / null box derives null (→ the profile shows the "no stats" empty state)');

console.log('\nPRIOR-SEASON BOX HARNESS PASSED');
