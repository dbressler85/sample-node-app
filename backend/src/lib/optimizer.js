'use strict';

// Lineup optimizer — pure logic, no I/O, so it's trivially testable and reusable
// for every league regardless of its roster rules.
//
// A league's starting requirements are a list of slot groups, e.g.
//   [ {name:'QB', eligible:['QB'], count:1},
//     {name:'RB', eligible:['RB'], count:2},
//     {name:'FLEX', eligible:['RB','WR','TE'], count:1} ]
// which we expand into individual slots and then fill from a pool of players
// (each {id, position, projection}) to maximize total projected points.
//
// Fantasy slot eligibility is "nested" (a FLEX/SUPERFLEX is a superset of the
// dedicated position slots), and for nested eligibility a greedy assignment that
// fills the most-restrictive slots first with the highest-projected eligible
// player is optimal. That's what assign() does.

function expandSlots(requirements) {
  const slots = [];
  for (const req of requirements || []) {
    const count = Number(req.count) || 0;
    for (let i = 0; i < count; i++) {
      slots.push({ name: req.name, eligible: req.eligible.slice() });
    }
  }
  return slots;
}

// Fill the given slots from `pool`, maximizing total projection.
// Returns per-slot assignment (player or null) aligned to expandSlots order.
function assign(requirements, pool) {
  const slots = expandSlots(requirements);
  const players = (pool || []).slice().sort((a, b) => proj(b) - proj(a));

  // Fill most-restrictive slots first (fewest eligible positions).
  const order = slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => a.slot.eligible.length - b.slot.eligible.length);

  const used = new Set();
  const assignment = new Array(slots.length).fill(null);

  for (const { slot, index } of order) {
    // players is already sorted desc by projection, so the first eligible unused
    // player is the best choice for this slot.
    const pick = players.find((p) => !used.has(p.id) && slot.eligible.includes(p.position));
    if (pick) {
      assignment[index] = pick;
      used.add(pick.id);
    }
  }
  return { slots, assignment };
}

function proj(p) {
  return p && Number.isFinite(p.projection) ? p.projection : 0;
}

function total(assignment) {
  return round1((assignment || []).reduce((sum, p) => sum + proj(p), 0));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Convenience: the optimal lineup drawn from all available players.
function optimize(requirements, availablePlayers) {
  const { slots, assignment } = assign(requirements, availablePlayers);
  return {
    slots,
    assignment,
    starterIds: assignment.filter(Boolean).map((p) => p.id),
    total: total(assignment),
    emptySlots: assignment.filter((p) => !p).length,
  };
}

module.exports = { expandSlots, assign, optimize, total, round1 };
