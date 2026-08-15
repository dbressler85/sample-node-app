'use strict';
// waivers.reconcileLocalClaims — the fix for "processed waiver claims still show as pending".
// MFL's pendingWaivers is authoritative: a locally-mirrored PENDING claim that MFL no longer lists
// has been settled by a run (won, or outbid) and must be dropped from the mirror so it stops showing
// as pending. A claim MFL still lists is represented by MFL's own row (deduped). A just-filed claim
// gets a short grace window so it never blinks out before MFL's read catches up.

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const { reconcileLocalClaims } = require('../../src/services/waivers');

const NOW = 1_700_000_000_000; // fixed clock
const GRACE = 120_000; // 2 min
const old = NOW - 60 * 60 * 1000; // an hour ago (well past grace)
const recent = NOW - 30 * 1000; // 30s ago (within grace)
const claim = (id, addId, status, at) => ({ id, add: { id: String(addId) }, status, at });
const ids = (arr) => arr.map((c) => c.id).sort();

(async () => {
  // THE BUG: a run cleared MFL's queue (empty authoritative set). An old app-submitted pending claim
  // — whether it WON or was OUTBID — must be removed from the mirror, not shown as pending.
  {
    const local = [claim('c1', 100, 'pending', old), claim('c2', 200, 'pending', old)];
    const { keep, removeIds } = reconcileLocalClaims(local, new Set(), NOW, GRACE);
    assert(keep.length === 0, 'empty MFL queue: no settled claim survives as pending [THE BUG]');
    assert(removeIds.sort().join(',') === 'c1,c2', 'both settled claims are removed from the mirror');
  }

  // A claim MFL STILL lists as pending is genuinely queued (waiting for its run) — kept via MFL's own
  // row (deduped out of the local merge), never removed.
  {
    const local = [claim('c1', 100, 'pending', old)];
    const { keep, removeIds } = reconcileLocalClaims(local, new Set(['100']), NOW, GRACE);
    assert(keep.length === 0 && removeIds.length === 0, 'claim still in MFL queue: deduped, not removed');
  }

  // A just-filed claim MFL has not caught up to yet is kept for the grace window (not removed).
  {
    const local = [claim('c3', 300, 'pending', recent)];
    const { keep, removeIds } = reconcileLocalClaims(local, new Set(), NOW, GRACE);
    assert(ids(keep).join() === 'c3' && removeIds.length === 0, 'just-filed pending claim survives the grace window');
  }

  // A legacy claim with no timestamp (pre-fix rows) is treated as not-fresh → cleaned when settled.
  {
    const local = [{ id: 'c5', add: { id: '500' }, status: 'pending' }];
    const { keep, removeIds } = reconcileLocalClaims(local, new Set(), NOW, GRACE);
    assert(keep.length === 0 && removeIds[0] === 'c5', 'legacy (no `at`) settled claim is cleaned');
  }

  // Non-pending mirrors (immediate/processed adds) are left untouched — they were never "pending".
  {
    const local = [{ id: 'c4', add: { id: '400' }, status: 'processed', at: old }];
    const { keep, removeIds } = reconcileLocalClaims(local, new Set(), NOW, GRACE);
    assert(ids(keep).join() === 'c4' && removeIds.length === 0, 'non-pending mirror passes through, not removed');
  }

  // add-as-plain-string shape (c.add is an id string, not an object) resolves the id correctly.
  {
    const local = [{ id: 'c6', add: '600', status: 'pending', at: old }];
    const settled = reconcileLocalClaims(local, new Set(), NOW, GRACE);
    assert(settled.removeIds[0] === 'c6', 'string-add settled claim is removed');
    const stillQueued = reconcileLocalClaims(local, new Set(['600']), NOW, GRACE);
    assert(stillQueued.keep.length === 0 && stillQueued.removeIds.length === 0, 'string-add claim still in MFL: deduped');
  }

  // Mixed batch: one won/settled (remove), one still-queued (dedup), one just-filed (keep).
  {
    const local = [
      claim('w', 100, 'pending', old), // settled by run
      claim('q', 200, 'pending', old), // still queued on MFL
      claim('f', 300, 'pending', recent), // just filed
    ];
    const { keep, removeIds } = reconcileLocalClaims(local, new Set(['200']), NOW, GRACE);
    assert(removeIds.join() === 'w', 'mixed: only the settled claim is removed');
    assert(ids(keep).join() === 'f', 'mixed: only the just-filed claim is kept in the local merge');
  }
  console.log('✓ reconcileLocalClaims: settled removed, queued deduped, just-filed kept, non-pending untouched');

  console.log('\nWAIVER PENDING RECONCILE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
