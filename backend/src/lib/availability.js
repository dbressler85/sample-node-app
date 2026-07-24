'use strict';

// Player availability — whether a player can/should be started this week.
//
// The optimizer must never start a player who is OUT, on IR, suspended, declared
// inactive, or on a bye; and it should flag (but still allow) Questionable/Doubtful
// players. Availability is derived from injury status + the team's bye week.

// Statuses that make a player unstartable. The IR/PUP/NFI/RETIRED/HOLDOUT variants are all real
// values MFL's `injuries` feed emits (confirmed against a live export) — before, they fell through
// as "startable", so the optimizer could have started a retired or IR-PUP player.
const UNAVAILABLE = new Set(['OUT', 'IR', 'IR-PUP', 'IR-NFI', 'PUP', 'NFI', 'RETIRED', 'HOLDOUT', 'SUSPENDED', 'INACTIVE', 'BYE']);

// Short display labels + severity (higher = worse) for sorting/urgency.
const SEVERITY = { OUT: 3, IR: 3, 'IR-PUP': 3, 'IR-NFI': 3, PUP: 3, NFI: 3, RETIRED: 3, HOLDOUT: 3, SUSPENDED: 3, INACTIVE: 3, BYE: 3, DOUBTFUL: 2, QUESTIONABLE: 1, ACTIVE: 0 };
const LABEL = { QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'OUT', IR: 'IR', 'IR-PUP': 'IR', 'IR-NFI': 'IR', PUP: 'PUP', NFI: 'NFI', RETIRED: 'RET', HOLDOUT: 'HOLD', INACTIVE: 'INA', SUSPENDED: 'SUS', BYE: 'BYE', ACTIVE: '' };

// Resolve a player's availability for the given week.
//   statusMap: { [playerId]: 'OUT' | 'QUESTIONABLE' | ... }
//   byeMap:    { [team]: byeWeekNumber }
function resolve(player, statusMap, byeMap, week) {
  const bye = byeMap && byeMap[player.team];
  if (bye && Number(bye) === Number(week)) {
    return { status: 'BYE', startable: false, severity: 3, label: 'BYE', reason: `${player.team} bye` };
  }
  const status = String((statusMap && statusMap[player.id]) || 'ACTIVE').toUpperCase();
  const startable = !UNAVAILABLE.has(status);
  return {
    status,
    startable,
    severity: SEVERITY[status] != null ? SEVERITY[status] : 0,
    label: LABEL[status] != null ? LABEL[status] : status,
    reason: startable ? null : status,
  };
}

module.exports = { resolve, UNAVAILABLE };
