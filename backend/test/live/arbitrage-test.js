'use strict';
// Cross-league value arbitrage. A player you roster in 2+ leagues is worth different amounts in each
// (format drives it — Superflex, TE-premium, league size), so the portfolio now surfaces where he's
// worth MOST vs LEAST — that's where to shop him. This proves the arbitrage list: (1) exists and is
// shaped right; (2) only surfaces real gaps (a same-format holding with ~0 spread is filtered out);
// (3) points the "high" league at the higher value; (4) is sorted biggest-gap first.
process.env.MFL_DEMO_MODE = 'true';

const portfolio = require('../../src/services/portfolio');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const dash = await portfolio.getDashboard('arb-test-token');
  const arb = dash.arbitrage;
  assert(Array.isArray(arb), 'arbitrage is an array');
  console.log(`✓ portfolio exposes an arbitrage list (${arb.length} opportunit${arb.length === 1 ? 'y' : 'ies'})`);

  // Every entry is a real, well-formed gap: high ≥ low, spread positive, both floors cleared.
  for (const a of arb) {
    assert(a.id && a.name && a.high && a.low, `entry ${a.name} carries id/name/high/low`);
    assert(a.high.value >= a.low.value, `${a.name}: high (${a.high.value}) ≥ low (${a.low.value})`);
    assert(a.spread === Math.round(a.high.value - a.low.value), `${a.name}: spread matches high−low`);
    assert(a.spread >= 8 && a.spreadPct >= 15, `${a.name}: only real gaps surface (spread ${a.spread}, ${a.spreadPct}%)`);
    assert(a.high.leagueId !== a.low.leagueId, `${a.name}: high and low are different leagues`);
    assert(a.leagues >= 2, `${a.name}: held in 2+ leagues`);
  }
  console.log('✓ every entry is a well-formed gap ≥ the absolute + relative floors, high league ≥ low');

  // Sorted biggest-gap first.
  for (let i = 1; i < arb.length; i++) assert(arb[i - 1].spread >= arb[i].spread, 'sorted by spread desc');
  if (arb.length) console.log(`✓ sorted biggest-gap first (top: ${arb[0].name}, ${arb[0].high.value} vs ${arb[0].low.value})`);

  // The demo book holds a TE across a TE-premium league and a standard one → a real, expected gap.
  assert(arb.some((a) => a.position === 'TE'), 'the demo TE-premium gap surfaces (a TE worth more in the TEP league)');
  console.log('✓ the demo TE-premium arbitrage surfaces as expected');

  console.log('\nARBITRAGE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
