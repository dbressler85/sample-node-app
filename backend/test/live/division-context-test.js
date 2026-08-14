'use strict';
// lib/divisionContext — multi-copy (per-division shared pool) detection + scoping, and the
// division-aware add-eligibility gate. The whole point of this harness is the SAFETY CONTRACT: a
// normal league that merely uses divisions (single shared pool, every player on one roster) must
// NEVER be detected as multi-copy and must NEVER be scoped. If a refactor regresses that, this fails.

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const { detect, makeContext, MULTICOPY_MIN_SHARE } = require('../../src/lib/divisionContext');
const { addEligibility } = require('../../src/lib/mflRepo');

// Build a franchise→division map: { '0001':'00', ... }. Ids are 4-padded to match mfl.fid.
function divMap(entries) {
  const m = new Map();
  for (const [id, div] of entries) m.set(String(id).padStart(4, '0'), div);
  return m;
}
// A rosters-export franchise: { id, player:[{id}] }.
const fr = (id, playerIds) => ({ id: String(id).padStart(4, '0'), player: playerIds.map((p) => ({ id: String(p) })) });

(async () => {
  // ---- detect(): the normal-league regression guards --------------------------------------------

  // Single division (or none) → never multi-copy, regardless of rosters.
  {
    const fd = divMap([['0001', '00'], ['0002', '00'], ['0003', '00']]);
    const rosters = [fr('0001', [1, 2, 3]), fr('0002', [4, 5, 6]), fr('0003', [7, 8, 9])];
    assert(detect(fd, rosters).multiCopy === false, 'single-division league → not multi-copy');
  }

  // NORMAL divisioned league: 3 divisions, 4 teams each, every player on EXACTLY one roster. This is
  // the user's league type that must be untouched. crossDivision = 0 → share 0 → false.
  {
    const fd = divMap([
      ['0001', '00'], ['0002', '00'], ['0003', '00'], ['0004', '00'],
      ['0005', '01'], ['0006', '01'], ['0007', '01'], ['0008', '01'],
      ['0009', '02'], ['0010', '02'], ['0011', '02'], ['0012', '02'],
    ]);
    const rosters = fd && [...fd.keys()].map((id, i) => fr(id, [i * 3 + 1, i * 3 + 2, i * 3 + 3]));
    const d = detect(fd, rosters);
    assert(d.multiCopy === false, 'NORMAL 3-division league (each player once) → NOT multi-copy [KEY REGRESSION GUARD]');
    assert(d.crossDivision === 0 && d.share === 0, 'normal divisioned: zero cross-division players');
  }

  // A single stray duplicate (mid-trade blip / data glitch) must NOT flip a normal league. One player
  // shared across two divisions out of a large pool sits far below the threshold.
  {
    const fd = divMap([
      ['0001', '00'], ['0002', '00'], ['0005', '01'], ['0006', '01'], ['0009', '02'], ['0010', '02'],
    ]);
    let pid = 100;
    const rosters = [...fd.keys()].map((id) => fr(id, Array.from({ length: 20 }, () => ++pid)));
    // Duplicate exactly ONE player: put player 101 (already on 0001/div00) onto 0005 (div01) too.
    rosters[2].player.push({ id: '101' });
    const d = detect(fd, rosters);
    assert(d.crossDivision === 1, 'exactly one cross-division player in this scenario');
    assert(d.share < MULTICOPY_MIN_SHARE && d.multiCopy === false, 'a single stray duplicate stays below threshold → not multi-copy');
  }

  // REAL multi-copy league: each of 3 divisions rosters the SAME full player pool → every player
  // appears in all 3 divisions → share = 1.0 → multi-copy.
  {
    const fd = divMap([['0001', '00'], ['0005', '01'], ['0009', '02']]);
    const pool = Array.from({ length: 30 }, (_, i) => i + 1);
    const rosters = [fr('0001', pool), fr('0005', pool), fr('0009', pool)];
    const d = detect(fd, rosters);
    assert(d.multiCopy === true, 'whole pool duplicated across divisions → multi-copy');
    assert(d.share === 1, 'multi-copy share is 1.0 when every player is duplicated');
  }

  // Fail-safe: divisions present but rosters missing/empty → cannot prove a shared pool → false.
  {
    const fd = divMap([['0001', '00'], ['0005', '01']]);
    assert(detect(fd, null).multiCopy === false, 'missing rosters → not multi-copy (fail safe)');
    assert(detect(fd, []).multiCopy === false, 'empty rosters → not multi-copy (fail safe)');
  }

  // Fail-safe: no division attributes at all (map values null) → <2 divisions → false.
  {
    const fd = divMap([['0001', null], ['0002', null]]);
    assert(detect(fd, [fr('0001', [1]), fr('0002', [1])]).multiCopy === false, 'no division attrs → not multi-copy');
  }
  console.log('✓ detect: normal divisioned + single-division + stray-dup stay FALSE; real shared pool TRUE; fail-safe');

  // ---- makeContext().includes(): scoping predicate ---------------------------------------------

  const fd = divMap([['0001', '00'], ['0002', '00'], ['0005', '01'], ['0009', '02']]);

  // Non-multi-copy context includes EVERY franchise (no scoping) — the normal-league path.
  {
    const ctx = makeContext({ multiCopy: false, myDivision: '00', franchiseDivision: fd });
    assert(ctx.includes('0001') && ctx.includes('0005') && ctx.includes('0009'), 'non-multi-copy includes all franchises (no scoping)');
  }
  // Multi-copy context includes only MY division.
  {
    const ctx = makeContext({ multiCopy: true, myDivision: '00', franchiseDivision: fd });
    assert(ctx.includes('0001') && ctx.includes('0002'), 'multi-copy includes my-division franchises');
    assert(!ctx.includes('0005') && !ctx.includes('0009'), 'multi-copy excludes other-division franchises');
    assert(ctx.includes(1) && !ctx.includes(5), 'includes() 4-pads numeric ids');
  }
  console.log('✓ includes: non-multi-copy keeps all; multi-copy keeps only my division');

  // ---- addEligibility(): division-aware add gate -----------------------------------------------

  const rosteredElsewhere = { id: '9', error: null, isFreeAgent: false, cantAdd: false, locked: false, franchises: [{ franchiseId: '0005', status: 'R' }] };
  const rosteredInMine = { id: '9', error: null, isFreeAgent: false, cantAdd: false, locked: false, franchises: [{ franchiseId: '0001', status: 'R' }] };
  const trueFreeAgent = { id: '9', error: null, isFreeAgent: true, cantAdd: false, locked: false, franchises: [] };

  // Normal league (no ctx): ANY rostering franchise blocks — the pre-fix behavior, unchanged.
  assert(addEligibility(rosteredElsewhere).addable === false, 'normal league: rostered anywhere → blocked (no regression)');
  assert(addEligibility(trueFreeAgent).addable === true, 'normal league: true free agent → addable');

  const mcCtx = makeContext({ multiCopy: true, myDivision: '00', franchiseDivision: fd });
  // Multi-copy: rostered only in ANOTHER division → addable for my team.
  assert(addEligibility(rosteredElsewhere, mcCtx).addable === true, 'multi-copy: rostered only in other division → addable');
  // Multi-copy: rostered in MY division → still blocked.
  assert(addEligibility(rosteredInMine, mcCtx).addable === false, 'multi-copy: rostered in my division → blocked');
  // Multi-copy: a locked other-division player is still not addable (game started).
  assert(addEligibility({ ...rosteredElsewhere, locked: true }, mcCtx).addable === false, 'multi-copy: locked → blocked even if other-division');
  // A non-multi-copy ctx behaves exactly like no ctx (belt-and-suspenders).
  const offCtx = makeContext({ multiCopy: false, myDivision: '00', franchiseDivision: fd });
  assert(addEligibility(rosteredElsewhere, offCtx).addable === false, 'multiCopy:false ctx → league-wide gate (no regression)');
  console.log('✓ addEligibility: division-aware only when multi-copy; normal path unchanged');

  console.log('\nDIVISION CONTEXT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
