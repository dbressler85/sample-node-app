'use strict';
// lib/rosterStatus — the single source for MFL roster-slot normalization, shared by roster buckets,
// the opponent matchup pool (lineups), team scouting (league), and trade candidates (trades). Accepts
// BOTH the rosters-export long forms (INJURED_RESERVE/TAXI_SQUAD) and the sibling export's short
// codes (IR/TS), case/space tolerant, exact-token (no substring false-positives).

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const { rosterSlot, isReserve } = require('../../src/lib/rosterStatus');

(async () => {
  // Long forms.
  assert(rosterSlot('INJURED_RESERVE') === 'ir', 'INJURED_RESERVE → ir');
  assert(rosterSlot('TAXI_SQUAD') === 'taxi', 'TAXI_SQUAD → taxi');
  assert(rosterSlot('starter') === 'starter', 'starter → starter');
  assert(rosterSlot('ROSTER') === 'active', 'ROSTER → active');
  assert(rosterSlot('') === 'active' && rosterSlot(null) === 'active', 'empty/null → active');
  // Short codes (sibling export vocabulary).
  assert(rosterSlot('IR') === 'ir' && rosterSlot('TS') === 'taxi' && rosterSlot('TAXI') === 'taxi', 'short codes IR/TS/TAXI map');
  // Case + whitespace + legacy roster_status field + player-object input.
  assert(rosterSlot(' injured_reserve ') === 'ir', 'trims + case-insensitive');
  assert(rosterSlot({ roster_status: 'taxi_squad' }) === 'taxi', 'reads player.roster_status');
  assert(rosterSlot({ status: 'IR' }) === 'ir', 'reads player.status');
  // No substring false-positives.
  assert(rosterSlot('TSX') === 'active' && rosterSlot('AIRLINE') === 'active', 'exact-token only (no substring)');
  console.log('✓ rosterSlot: both vocabularies, case/space, object input, exact-token');

  // isReserve = ir || taxi.
  assert(isReserve('IR') && isReserve('TAXI_SQUAD') && isReserve({ status: 'TS' }), 'isReserve true for IR/taxi');
  assert(!isReserve('starter') && !isReserve('ROSTER') && !isReserve(''), 'isReserve false for active/starter/empty');
  console.log('✓ isReserve: true only for IR/taxi');

  console.log('\nROSTER STATUS LIB HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
