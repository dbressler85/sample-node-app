'use strict';

// MFL's roster-slot tokens aren't consistent across exports: the `rosters` export uses the long
// forms INJURED_RESERVE / TAXI_SQUAD (plus lowercase `starter` for a player in a set weekly lineup),
// while the sibling `playerRosterStatus` export uses short codes IR / TS. We couldn't confirm which
// the rosters export returns for an owner with no current IR/taxi player (offseason), so accept BOTH
// everywhere. Centralized here so every consumer — roster buckets, the opponent matchup pool, team
// scouting, and trade-candidate lists — agrees; a divergent copy would silently miscount an IR/taxi
// player as active and (for the roster view) suppress the illegal-IR alert.
//
// Match EXACT tokens case-insensitively — never a substring test — so a normal roster status (e.g.
// one that merely contains "TS") can't false-positive into a reserve slot.

const IR_STATUS = new Set(['INJURED_RESERVE', 'IR']);
const TAXI_STATUS = new Set(['TAXI_SQUAD', 'TAXI', 'TS']);

// Coarse roster slot for a player: 'ir' | 'taxi' | 'starter' | 'active'. Accepts either the raw
// status string or a player object (reads `status`, falling back to the legacy `roster_status`).
function rosterSlot(p) {
  const raw = String((p && typeof p === 'object' ? p.status || p.roster_status : p) || '')
    .trim()
    .toUpperCase();
  if (IR_STATUS.has(raw)) return 'ir';
  if (TAXI_STATUS.has(raw)) return 'taxi';
  if (raw === 'STARTER') return 'starter';
  return 'active';
}

// True when the player is on IR or the taxi squad — i.e. NOT part of the active/matchup pool.
function isReserve(p) {
  const slot = rosterSlot(p);
  return slot === 'ir' || slot === 'taxi';
}

module.exports = { rosterSlot, isReserve };
