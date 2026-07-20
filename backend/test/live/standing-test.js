'use strict';

// The shared "where does this player stand" primitive — the single classifier now behind
// the profile's cross-league card, the watchlist roll-up, and exposure. Locks the
// canonical vocabulary so the three surfaces can't drift apart again.

const standing = require('../../src/lib/standing');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const roster = {
  starters: [{ id: 'p1' }],
  bench: [{ id: 'p2' }],
  ir: [{ id: 'p3' }],
  taxi: [{ id: 'p4' }],
};
const faSet = new Set(['p5']);

(async () => {
  // Each roster slot classifies to its bucket, mine=true.
  for (const [id, slot] of [['p1', 'starter'], ['p2', 'bench'], ['p3', 'ir'], ['p4', 'taxi']]) {
    const s = standing.standing(roster, faSet, id);
    assert(s.mine === true && s.where === slot && s.bucket === slot, `${id} → ${slot} (mine)`);
    assert(standing.rosterBucket(roster, id) === slot, `rosterBucket ${id} → ${slot}`);
  }

  // Free agent.
  const free = standing.standing(roster, faSet, 'p5');
  assert(free.where === 'free' && free.mine === false && free.bucket === null, 'free agent → free, not mine');

  // On another team (not on my roster, not a FA).
  const other = standing.standing(roster, faSet, 'p9');
  assert(other.where === 'other' && other.mine === false && other.bucket === null, 'unrostered non-FA → other');
  assert(standing.rosterBucket(roster, 'p9') === null, 'rosterBucket returns null when absent');

  // Defensive: missing roster / faSet don't throw.
  assert(standing.standing({}, null, 'p1').where === 'other', 'empty roster + no faSet → other, no throw');

  // BUCKETS is the shared source of truth (key → slot-name pairs).
  const names = standing.BUCKETS.map(([, name]) => name);
  assert(names.join(',') === 'starter,bench,ir,taxi', 'BUCKETS names in canonical order');

  console.log('✓ standing: buckets, free, other, defensive, shared BUCKETS constant');
  console.log('\nSTANDING HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
