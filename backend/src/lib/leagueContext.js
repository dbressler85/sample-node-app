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

// "1QB · 2RB · 3WR · 1TE · 2FLEX" — every required starting slot with its count.
function lineupLabel(reqs) {
  return (reqs || [])
    .slice()
    .sort((a, b) => posRank(a.name) - posRank(b.name))
    .map((r) => `${r.count || 1}${r.name}`)
    .join(' · ');
}

async function build(cookie, league) {
  const [fmt, reqs] = await Promise.all([
    leagueFormat.format(cookie, league),
    leagueFormat.requirements(cookie, league),
  ]);
  const superflex = !!(fmt && fmt.numQbs >= 2);
  const ppr = fmt && fmt.ppr != null ? fmt.ppr : 1;
  // Extra points per TE reception above the base — the "TE premium" that lifts TE value.
  const tePremium = fmt && fmt.tePpr != null && fmt.tePpr > ppr ? Math.round((fmt.tePpr - ppr) * 100) / 100 : 0;
  const starters = (reqs || []).map((r) => ({ slot: r.name, count: r.count || 1, eligible: r.eligible || [] }));
  return {
    scoringLabel: leagueFormat.label(fmt),
    superflex,
    ppr,
    pprLabel: ppr >= 1 ? 'Full PPR' : ppr >= 0.5 ? 'Half PPR' : 'Standard',
    tePremium,
    lineup: {
      label: lineupLabel(reqs),
      starters,
      totalStarters: starters.reduce((s, r) => s + (r.count || 0), 0),
    },
  };
}

module.exports = { build, lineupLabel };
