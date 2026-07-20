'use strict';

// The trade-hub "start a trade here" fit nudge: from a league's needs/surplus map, find
// the positions where I have surplus AND a rival has a need, ranked by how many rivals.

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // Me (F1): surplus RB + WR. Rivals: two need RB, one needs WR, one needs QB (no match).
  const ns = {
    F1: { needs: [{ pos: 'QB', gap: 20 }], surplus: [{ pos: 'RB', depth: 40 }, { pos: 'WR', depth: 30 }] },
    F2: { needs: [{ pos: 'RB', gap: 15 }], surplus: [] },
    F3: { needs: [{ pos: 'RB', gap: 10 }, { pos: 'WR', gap: 8 }], surplus: [] },
    F4: { needs: [{ pos: 'QB', gap: 25 }], surplus: [] },
  };
  const fit = trades.tradeFitSummary(ns, 'F1');
  console.log('fit:', JSON.stringify(fit));
  assert(fit, 'a fit is found when my surplus meets a rival need');
  assert(fit.topPos === 'RB' && fit.rivals === 2, 'RB leads: two rivals need it');
  assert(fit.positions.includes('WR'), 'WR is also a fit (one rival)');
  assert(!fit.positions.includes('QB'), 'QB is my need, not surplus — not a fit');

  // No surplus → no fit.
  assert(trades.tradeFitSummary({ F1: { needs: [{ pos: 'RB', gap: 5 }], surplus: [] } }, 'F1') === null, 'no surplus → null');
  // Surplus but no rival needs it → no fit.
  const noMatch = { F1: { needs: [], surplus: [{ pos: 'TE', depth: 20 }] }, F2: { needs: [{ pos: 'RB', gap: 5 }], surplus: [] } };
  assert(trades.tradeFitSummary(noMatch, 'F1') === null, 'surplus with no matching rival need → null');
  // Unknown franchise → null (defensive).
  assert(trades.tradeFitSummary(ns, 'F9') === null, 'unknown franchise → null');

  console.log('✓ trade-fit summary matches my surplus to rivals\' needs, ranked');
  console.log('\nTRADE FIT SUMMARY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
