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

// A fair give-package for acquiring `targetValue`, biased to (a) players at the partner's
// NEED positions — so the offer actually helps them — and (b) players YOU'RE already
// shopping (your trade bait), since you want to move them anyway. Prefers a fair single,
// else a small package; never a gross overpay. `mine` = [{ id, name, position, value }].
function suggestGive(mine, targetValue, partnerNeeds, myBait) {
  const needSet = new Set((partnerNeeds || []).map((n) => n.pos));
  const bait = myBait instanceof Set ? myBait : new Set(myBait || []);
  const pool = mine
    .filter((p) => (p.value || 0) > 0)
    .map((p) => ({ ...p, fit: needSet.has(p.position), bait: bait.has(String(p.id)) }));
  if (!pool.length) return [];
  // Priority: a player who both fits their need and is on your block outranks one that
  // does only one, which outranks a plain filler.
  const prio = (p) => (p.fit ? 1 : 0) + (p.bait ? 1 : 0);
  if (!targetValue) return [pool.sort((a, b) => prio(b) - prio(a) || (b.value || 0) - (a.value || 0))[0]];

  // A fair single (85–125% of target): highest priority, then closest by value.
  const singles = pool
    .filter((p) => p.value >= targetValue * 0.85 && p.value <= targetValue * 1.25)
    .sort((a, b) => prio(b) - prio(a) || Math.abs(a.value - targetValue) - Math.abs(b.value - targetValue));
  if (singles.length) return [singles[0]];

  // Otherwise assemble: priority first (value desc), stopping when fair. Don't lead with
  // a whale worth more than the target, and never overpay past ~125%.
  const ordered = pool.slice().sort((a, b) => prio(b) - prio(a) || b.value - a.value);
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

// Roster-construction read on an incoming offer, independent of raw value: does it fix a
// hole or open one? `give` = players you'd send, `receive` = players you'd get, each with
// a `position`. myNeeds/mySurplus are your league-relative needs/surplus (from needsSurplus).
// Returns { rating: 'good'|'neutral'|'caution', reason, fills:[pos], thins:[pos] }.
function constructionVerdict(give, receive, myNeeds, mySurplus) {
  const needSet = new Set((myNeeds || []).map((n) => n.pos));
  const surSet = new Set((mySurplus || []).map((s) => s.pos));
  const giveFromNeed = (give || []).filter((p) => needSet.has(p.position));
  const giveFromSurplus = (give || []).filter((p) => surSet.has(p.position));
  const recvFillsNeed = (receive || []).filter((p) => needSet.has(p.position));
  const recvOntoSurplus = (receive || []).filter((p) => surSet.has(p.position));

  let score = 0;
  score += recvFillsNeed.length * 2;     // getting what you're thin at — strong plus
  score += giveFromSurplus.length;       // dealing from depth — plus
  score -= giveFromNeed.length * 2;      // dealing away a need — strong minus
  score -= recvOntoSurplus.length * 0.5; // piling onto a strength — minor minus

  const fills = [...new Set(recvFillsNeed.map((p) => p.position))];
  const thins = [...new Set(giveFromNeed.map((p) => p.position))];
  const fromDepth = [...new Set(giveFromSurplus.map((p) => p.position))];

  let rating;
  let reason;
  if (thins.length && !fills.length) {
    rating = 'caution';
    reason = `Sends a ${thins.join('/')} you're already thin at — don't do it unless the value is a steal.`;
  } else if (score >= 2) {
    rating = 'good';
    if (fills.length && fromDepth.length) reason = `Fills your ${fills.join('/')} need from ${fromDepth.join('/')} depth — a real roster fit.`;
    else if (fills.length) reason = `Fills your ${fills.join('/')} need.`;
    else reason = `Deals from your ${fromDepth.join('/')} depth.`;
  } else if (score <= -1) {
    rating = 'caution';
    reason = thins.length ? `Thins your ${thins.join('/')} without filling a need.` : `Piles onto a spot you're already deep at.`;
  } else {
    rating = 'neutral';
    reason = 'Roster-neutral — it comes down to value.';
  }
  return { rating, reason, fills, thins };
}

module.exports = { positionSlots, needsSurplus, suggestGive, constructionVerdict };
