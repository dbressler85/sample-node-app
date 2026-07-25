'use strict';
// Service module-graph guard. Several services eagerly require each other; the ONE genuine cycle is
// draft ↔ waivers (draft.js eagerly requires waivers, so waivers must lazy-require draft — hoisting it
// to top-level would capture a half-initialized draft export and crash at request time). Every OTHER
// cross-service require was hoisted to top-level once proven acyclic. This test locks that in: it loads
// every service under several worst-case first-load orders and asserts NO module comes out with an
// `undefined` export — the signature of a partial-export cycle. If someone hoists the real draft↔waivers
// edge (or introduces a new cycle), a service's exports go undefined here and this fails loudly.
process.env.MFL_DEMO_MODE = 'true';

const path = require('path');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const SERVICES = [
  'draft', 'trades', 'waivers', 'portfolio', 'watchlist', 'playerhub', 'trophies', 'playoffs',
  'roster', 'leagues', 'lineups', 'ondeck', 'notifications', 'exposure', 'scoreboard', 'tradebait',
  'league', 'dashboard',
];

function loadAll(order) {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  const partials = [];
  for (const s of order) {
    const m = require(path.join(__dirname, '..', '..', 'src', 'services', s));
    const undef = Object.keys(m).filter((k) => m[k] === undefined);
    if (undef.length) partials.push(`${s}: ${undef.join(',')}`);
  }
  return partials;
}

// Each formerly-lazy edge's owning module loaded FIRST is the worst case for a would-be partial export.
const ORDERS = {
  'portfolio-first': ['portfolio', ...SERVICES],
  'watchlist-first': ['watchlist', ...SERVICES],
  'playerhub-first': ['playerhub', ...SERVICES],
  'trophies-first': ['trophies', ...SERVICES],
  'waivers-first': ['waivers', ...SERVICES],
  'draft-first': ['draft', ...SERVICES],
  'registration-order': SERVICES,
};

for (const [tag, order] of Object.entries(ORDERS)) {
  const partials = loadAll(order);
  assert(partials.length === 0, `${tag} produced partial exports: ${partials.join(' | ')}`);
  console.log(`✓ ${tag}: every service loaded with complete exports`);
}

console.log('\nSERVICE GRAPH HARNESS PASSED');
