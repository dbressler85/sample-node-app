'use strict';

// MFL returns free agents as one `leagueUnit` PER division (unit="DIVISION00"/"01"/...). In a MULTI-COPY
// league each division is an independent pool, so flattening every unit surfaces players who aren't free
// in MY division. freeAgentIdsFromUnits(units, divCtx) must keep only my division's unit when multiCopy,
// and keep EVERY unit for a normal league (single LEAGUE unit, or multiCopy:false). Modeled on the real
// league 57104 response: DIVISION00..03 each with their own pool.

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const { freeAgentIdsFromUnits } = require('../../src/services/waivers');
const { makeContext } = require('../../src/lib/divisionContext');

// Four per-division units (like league 57104). Player id encodes its division so we can assert scoping.
const UNITS = [
  { unit: 'DIVISION00', player: [{ id: '1000' }, { id: '1001' }] },
  { unit: 'DIVISION01', player: [{ id: '1100' }, { id: '1101' }, { id: '1102' }] }, // my division
  { unit: 'DIVISION02', player: [{ id: '1200' }] },
  { unit: 'DIVISION03', player: [{ id: '1300' }, { id: '1301' }] },
];
const fd = new Map([['0001', '00'], ['0011', '01'], ['0021', '02'], ['0031', '03']]);

(async () => {
  // MULTI-COPY, my division = 01 → only DIVISION01's three players, none from the other divisions.
  const mc = makeContext({ multiCopy: true, myDivision: '01', franchiseDivision: fd });
  const mine = freeAgentIdsFromUnits(UNITS, mc);
  assert(mine.length === 3, `multi-copy scopes to my division's unit (3 players), got ${mine.length}: ${mine.join(',')}`);
  assert(mine.every((id) => id.startsWith('11')), `only DIVISION01 players, got ${mine.join(',')}`);
  assert(!mine.includes('1000') && !mine.includes('1200') && !mine.includes('1300'), 'excludes other divisions');
  console.log('✓ multi-copy: free agents scoped to my division’s leagueUnit');

  // NORMAL league (multiCopy:false) → every unit kept, byte-for-byte today's behavior (no regression).
  const off = makeContext({ multiCopy: false, myDivision: '01', franchiseDivision: fd });
  const all = freeAgentIdsFromUnits(UNITS, off);
  assert(all.length === 8, `normal league keeps every unit's players (8), got ${all.length}`);
  console.log('✓ normal league: every unit kept (no regression)');

  // No ctx at all (the default) also keeps everything — the pure flatten.
  assert(freeAgentIdsFromUnits(UNITS).length === 8, 'no ctx → flatten all units');

  // A single LEAGUE unit (normal divisionless league) is untouched even under a multi-copy ctx —
  // fail-open: never hide the whole pool when the unit label doesn't match my division.
  const single = [{ unit: 'LEAGUE', player: [{ id: '5' }, { id: '6' }] }];
  assert(freeAgentIdsFromUnits(single, mc).length === 2, 'unmatched unit label → keep all (fail-open, never empty)');
  console.log('✓ fail-open: an unmatched/LEAGUE unit is never hidden');

  console.log('\nFREE-AGENT DIVISION UNIT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
