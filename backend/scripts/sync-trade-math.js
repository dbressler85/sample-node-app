'use strict';

// Regenerates mobile/src/tradeMath.js from the canonical backend/src/lib/tradeMath.js, so the
// mobile trade desk and the backend share ONE trade-math implementation instead of two copies
// that drift. Run after editing the canonical:  npm run sync:trade-math  (from backend/).
//
// The mobile copy is the canonical verbatim with a "generated" banner prepended. A CI drift test
// (test/live/trade-math-sync-test.js) regenerates in-memory and fails if the committed mobile
// copy doesn't match — so a change to the canonical that isn't synced can't merge.

const fs = require('fs');
const path = require('path');

const CANONICAL = path.join(__dirname, '..', 'src', 'lib', 'tradeMath.js');
const MOBILE = path.join(__dirname, '..', '..', 'mobile', 'src', 'tradeMath.js');

const BANNER = [
  '// @generated DO NOT EDIT — copy of backend/src/lib/tradeMath.js.',
  '// Synced by backend/scripts/sync-trade-math.js (npm run sync:trade-math in backend/).',
  '// Edit the backend canonical, then re-run the sync; a CI drift test keeps the two identical.',
  '',
  '',
].join('\n');

// The exact bytes the mobile copy must contain for a given canonical source.
function generate(canonicalSource) {
  return BANNER + canonicalSource;
}

if (require.main === module) {
  const src = fs.readFileSync(CANONICAL, 'utf8');
  fs.writeFileSync(MOBILE, generate(src));
  console.log(`synced → ${path.relative(path.join(__dirname, '..', '..'), MOBILE)}`);
}

module.exports = { generate, CANONICAL, MOBILE, BANNER };
