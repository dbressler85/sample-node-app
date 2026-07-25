'use strict';

// Regenerates mobile/src/mflRead.js from the canonical backend/src/lib/mflRead.js, so the mobile app
// and the backend share ONE MFL read core (URL builder + parse + primitives) instead of two copies
// that drift. Run after editing the canonical:  npm run sync:mfl-read  (from backend/).
//
// The mobile copy is the canonical verbatim with a "generated" banner prepended. A CI drift test
// (test/live/mfl-read-sync-test.js) regenerates in-memory and fails if the committed mobile copy
// doesn't match — so a change to the canonical that isn't synced can't merge. Same pattern as
// scripts/sync-trade-math.js.

const fs = require('fs');
const path = require('path');

const CANONICAL = path.join(__dirname, '..', 'src', 'lib', 'mflRead.js');
const MOBILE = path.join(__dirname, '..', '..', 'mobile', 'src', 'mflRead.js');

const BANNER = [
  '// @generated DO NOT EDIT — copy of backend/src/lib/mflRead.js.',
  '// Synced by backend/scripts/sync-mfl-read.js (npm run sync:mfl-read in backend/).',
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
