'use strict';

// Trade fit: positional NEEDS and SURPLUS for each franchise, league-relative, plus a
// fit-aware give-package suggestion. "Needs" are the positions where a team's starters
// are thin or below the league; "surplus" are positions where they hold startable-quality
// depth beyond their starting slots. A good offer sends the other team players at their
// needs, drawn from your surplus — and the values (already format-aware per league) match.

// Starting demand per position, distributing flex slots across their eligible spots.
function positionSlots(requirements) {
  const slots = {};
  for (const r of requirements || []) {
    const elig = (r.eligible && r.eligible.length ? r.eligible : [r.name]).filter(Boolean);
    if (!elig.length) continue;
    const per = (r.count || 1) / elig.length;
    for (const pos of elig) slots[pos] = (slots[pos] || 0) + per;
  }
  return slots;
}

// One franchise's per-position picture: how good their starters are and their best
// backup, given how many they're expected to start at each spot.
function breakdown(players, slots) {
  const byPos = {};
  for (const p of players) {
    if (p.value == null) continue;
    (byPos[p.position] || (byPos[p.position] = [])).push(p.value);
  }
  const out = {};
  for (const [pos, vals] of Object.entries(byPos)) {
    vals.sort((a, b) => b - a);
    const nStart = Math.max(1, Math.round(slots[pos] || 0));
    const starters = vals.slice(0, nStart);
    const starterVal = starters.length ? starters.reduce((s, v) => s + v, 0) / starters.length : 0;
    const bench = vals.slice(nStart);
    out[pos] = { count: vals.length, nStart, starterVal, depthVal: bench.length ? bench[0] : 0 };
  }
  return out;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// needs/surplus for every franchise, keyed by franchiseId. Positions are ranked by how
// badly they're needed (gap below the league) / how much surplus depth they hold.
function needsSurplus(franchises, requirements) {
  const slots = positionSlots(requirements);
  const started = Object.keys(slots).filter((p) => slots[p] >= 0.5 && !['PK', 'DEF'].includes(p));
  const bds = franchises.map((f) => ({ franchiseId: String(f.franchiseId), bd: breakdown(f.players, slots) }));

  const medStarter = {};
  for (const pos of started) medStarter[pos] = median(bds.map((b) => (b.bd[pos] ? b.bd[pos].starterVal : 0)));

  const out = {};
  for (const { franchiseId, bd } of bds) {
    const needs = [];
    const surplus = [];
    for (const pos of started) {
      const b = bd[pos] || { count: 0, nStart: Math.max(1, Math.round(slots[pos])), starterVal: 0, depthVal: 0 };
      const med = medStarter[pos] || 0;
      if (b.count < b.nStart || (med > 0 && b.starterVal < med * 0.85)) {
        needs.push({ pos, gap: Math.round(Math.max(1, med - b.starterVal)) });
      }
      if (b.depthVal > 0 && med > 0 && b.depthVal >= med * 0.6 && b.starterVal >= med * 0.9) {
        surplus.push({ pos, depth: Math.round(b.depthVal) });
      }
    }
    needs.sort((a, b) => b.gap - a.gap);
    surplus.sort((a, b) => b.depth - a.depth);
    out[franchiseId] = { needs: needs.slice(0, 4), surplus: surplus.slice(0, 4) };
  }
  return out;
}

// A fair give-package for acquiring `targetValue`, biased to players at the partner's
// NEED positions (so the offer actually helps them). Prefers a fair single, else a small
// package; never a gross overpay. `mine` = [{ id, name, position, value }].
function suggestGive(mine, targetValue, partnerNeeds) {
  const needSet = new Set((partnerNeeds || []).map((n) => n.pos));
  const pool = mine.filter((p) => (p.value || 0) > 0).map((p) => ({ ...p, fit: needSet.has(p.position) }));
  if (!pool.length) return [];
  if (!targetValue) return [pool.sort((a, b) => (b.value || 0) - (a.value || 0))[0]];

  // A fair single (85–125% of target), fit first, then closest by value.
  const singles = pool
    .filter((p) => p.value >= targetValue * 0.85 && p.value <= targetValue * 1.25)
    .sort((a, b) => b.fit - a.fit || Math.abs(a.value - targetValue) - Math.abs(b.value - targetValue));
  if (singles.length) return [singles[0]];

  // Otherwise assemble: fit players first (value desc), stopping when fair. Don't lead
  // with a whale worth more than the target, and never overpay past ~125%.
  const ordered = pool.slice().sort((a, b) => b.fit - a.fit || b.value - a.value);
  const pkg = [];
  let sum = 0;
  for (const p of ordered) {
    if (!pkg.length && p.value > targetValue * 1.1) continue;
    if (sum + p.value > targetValue * 1.25) continue;
    pkg.push(p);
    sum += p.value;
    if (pkg.length >= 3 || sum >= targetValue * 0.9) break;
  }
  if (pkg.length) return pkg;
  // Everyone's too big (a stacked roster) — offer the smallest single.
  return [pool.sort((a, b) => a.value - b.value)[0]];
}

module.exports = { positionSlots, needsSurplus, suggestGive };
