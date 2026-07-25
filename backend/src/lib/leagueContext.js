'use strict';

// A display-ready "what kind of league is this" summary — SCORING + STARTING LINEUP — that the
// draft, draft-list, and trade-bait screens share, so a pick/trade/waiver decision carries the
// format context that actually changes it: is it superflex (QBs spike) or 1QB? Full/half/no PPR?
// A TE-reception premium? And how many of each position you must START (needing 3 WR vs 2, or 1 RB
// vs 3, changes positional scarcity a lot). Team context (outlook / age / strength) is layered on
// by each caller from its own roster read, since that's a heavier fetch.

const leagueFormat = require('./leagueformat');

// Sort starting-lineup slots into a natural football order for the label.
const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'OP', 'K', 'PK', 'DEF', 'DST'];
const posRank = (n) => { const i = POS_ORDER.indexOf(n); return i === -1 ? POS_ORDER.length : i; };

// One slot's label: "1QB", or "≤3RB" when it's a range ("up to 3"), so a min-max lineup reads
// honestly instead of implying you start the max at every position.
function slotLabel(r) {
  const max = r.max != null ? r.max : r.count || 1;
  const min = r.min != null ? r.min : max;
  return min < max ? `≤${max}${r.slot || r.name}` : `${max}${r.slot || r.name}`;
}

// "1QB · ≤3RB · ≤5WR · 1TE · 1K · 1DEF" — every starting slot with its (possibly ranged) count.
function lineupLabel(reqs) {
  return (reqs || [])
    .slice()
    .sort((a, b) => posRank(a.slot || a.name) - posRank(b.slot || b.name))
    .map(slotLabel)
    .join(' · ');
}

async function build(cookie, league) {
  const [fmt, spec] = await Promise.all([
    leagueFormat.format(cookie, league),
    leagueFormat.startersSpec(cookie, league),
  ]);
  const superflex = !!(fmt && fmt.numQbs >= 2);
  const ppr = fmt && fmt.ppr != null ? fmt.ppr : 1;
  // Extra points per TE reception above the base — the "TE premium" that lifts TE value.
  const tePremium = fmt && fmt.tePpr != null && fmt.tePpr > ppr ? Math.round((fmt.tePpr - ppr) * 100) / 100 : 0;
  // Per-slot: keep min/max so the UI can show ranges; `count` (max) stays for callers that expect it.
  const starters = (spec.slots || []).map((r) => ({ slot: r.name, count: r.count || 1, min: r.min != null ? r.min : r.count || 1, max: r.max != null ? r.max : r.count || 1, eligible: r.eligible || [] }));
  // `hasRange` lets the UI note the label is a set of maximums whose true total is `totalStarters`.
  const hasRange = starters.some((r) => r.min < r.max);
  return {
    scoringLabel: leagueFormat.label(fmt),
    superflex,
    ppr,
    pprLabel: ppr >= 1 ? 'Full PPR' : ppr >= 0.5 ? 'Half PPR' : 'Standard',
    tePremium,
    lineup: {
      label: lineupLabel(starters),
      starters,
      // Authoritative number of players you actually start (MFL's `starters count`), which for a
      // min-max lineup is LESS than the sum of the per-position maximums.
      totalStarters: spec.total,
      hasRange,
    },
  };
}

module.exports = { build, lineupLabel };
