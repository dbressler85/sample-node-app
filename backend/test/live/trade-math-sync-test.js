'use strict';

// Drift guard for the shared trade-math module. mobile/src/tradeMath.js is a GENERATED copy of
// backend/src/lib/tradeMath.js (see scripts/sync-trade-math.js). This test regenerates the
// expected mobile bytes from the current canonical and asserts the committed copy matches — so a
// tuning change to the canonical that isn't synced fails CI instead of letting the mobile trade
// preview silently disagree with the backend's verdict. If this fails: run `npm run sync:trade-math`.
//
// Also spot-checks that the shared functions actually behave, and that a hand-diverged copy would
// be caught (guards against a no-op comparison).

const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const { generate, CANONICAL, MOBILE } = require('../../scripts/sync-trade-math');
const tradeMath = require('../../src/lib/tradeMath');

(async () => {
  // 1. The committed mobile copy is exactly what the sync script would produce now.
  const canonicalSrc = fs.readFileSync(CANONICAL, 'utf8');
  const mobileSrc = fs.readFileSync(MOBILE, 'utf8');
  assert(mobileSrc === generate(canonicalSrc), 'mobile/src/tradeMath.js is stale — run `npm run sync:trade-math`');

  // 2. A diverged copy WOULD be caught (the comparison isn't vacuous).
  assert(generate(canonicalSrc + '\n// tweak') !== mobileSrc, 'drift comparison is live (a change would fail)');

  // 3. The shared math behaves — value verdict thresholds.
  const fav = tradeMath.analyze([{ value: 100 }], [{ value: 80 }]);
  assert(fav.verdict === 'favorable' && fav.net === 20, 'analyze: clear gain → favorable');
  const fair = tradeMath.analyze([{ value: 100 }], [{ value: 98 }]);
  assert(fair.verdict === 'fair', 'analyze: tiny net → fair (below thresholds)');
  const unfav = tradeMath.analyze([{ value: 60 }], [{ value: 90 }]);
  assert(unfav.verdict === 'unfavorable', 'analyze: clear loss → unfavorable');

  // 4. Personal lens applies Target/Avoid and is null when nothing's tagged.
  assert(tradeMath.personalAnalyze([{ value: 100 }], [{ value: 100 }]) === null, 'personalAnalyze: untagged → null');
  const pa = tradeMath.personalAnalyze([{ value: 100, tag: 'target' }], [{ value: 100 }]);
  assert(pa && pa.acquireValue === 110, 'personalAnalyze: target ×1.1 applied');

  // 5. Construction rating branches: a clean fit vs a self-inflicted hole.
  const needs = [{ pos: 'RB' }];
  const surplus = [{ pos: 'WR' }];
  const fit = tradeMath.constructionRating([{ position: 'WR', value: 50 }], [{ position: 'RB', value: 50 }], needs, surplus, 'you', null);
  assert(fit.rating === 'good' && fit.branch === 'fit', 'constructionRating: fill a need from surplus → good/fit');
  const depth = { RB: { threshold: 40, startable: 1, slots: 1 } };
  const hole = tradeMath.constructionRating([{ position: 'RB', value: 90 }], [{ position: 'WR', value: 90 }], [], [], 'you', depth);
  assert(hole.rating === 'caution' && hole.branch === 'hole', 'constructionRating: trade away only startable RB → caution/hole');

  console.log('✓ trade-math: mobile copy in sync; analyze/personal/construction behave');
  console.log('\nTRADE MATH SYNC HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
