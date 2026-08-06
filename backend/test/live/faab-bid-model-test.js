'use strict';
// Smarter FAAB bid suggestion (docs: PO review). The old model scaled remaining budget by raw dynasty
// value and saturated to "bid ~everything" for anyone worth rostering, blind to contention, the
// calendar, and roster fit. This pins the new behavior: budget × posture × season-phase × roster-fit,
// returned as a save/target/max range + rationale — and, critically, that it NEVER runaway-clamps to
// the whole budget for a middling pickup.
process.env.MFL_DEMO_MODE = 'true';
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const waivers = require('../../src/services/waivers');
const plan = (settings, add, opts) => waivers.suggestBidPlan(settings, add, opts);

// $100 budget, $1 min, $1 increments.
const S = { system: 'faab', faabRemaining: 100, minBid: 1, bidIncrement: 1 };
// A roster that STARTS a WR worth 3000 (so a 4000 WR is an upgrade, an 800 WR is a bench flyer).
const ROSTER = { starters: [{ id: 's1', position: 'WR', value: 3000 }, { id: 's2', position: 'RB', value: 2500 }], summary: { outlook: 'Balanced' } };
const wr = (value) => ({ position: 'WR', value, trend: 0 });

(async () => {
  // Non-FAAB → no suggestion.
  assert(plan({ system: 'fcfs' }, wr(4000)) === null, 'non-FAAB league yields no bid plan');

  // Range is always ordered + legal.
  const p = plan(S, wr(4000), { roster: ROSTER, week: 8, outlook: 'Win-now window' });
  assert(p && p.save <= p.target && p.target <= p.max, `range is ordered save≤target≤max, got ${JSON.stringify(p)}`);
  assert(p.max <= 100 && p.save >= 1, 'range stays within [min, remaining]');
  assert(typeof p.rationale === 'string' && p.rationale.length, 'a rationale string is returned');
  console.log('✓ returns an ordered, legal {save,target,max} range + rationale:', JSON.stringify(p));

  // NO SATURATION: the old model bid ~all $100 for any valued player. A rebuilder early-season on a
  // mere bench flyer must bid a small token, NOT the budget.
  const flyerRebuildEarly = plan(S, wr(800), { roster: ROSTER, week: 2, outlook: 'Rebuilding' });
  assert(flyerRebuildEarly.target <= 5, `rebuild + early + bench flyer is a token bid, got $${flyerRebuildEarly.target}`);
  console.log(`✓ no saturation — rebuild/early/flyer target $${flyerRebuildEarly.target} (was ~$100 under the old model)`);

  // CONTENTION matters: a contender bids more than a rebuilder for the SAME upgrade, same week.
  const upWk = { roster: ROSTER, week: 12 };
  const cont = plan(S, wr(4000), { ...upWk, outlook: 'Win-now window' }).target;
  const reb = plan(S, wr(4000), { ...upWk, outlook: 'Rebuilding' }).target;
  assert(cont > reb, `contender bids more than rebuilder for the same upgrade (${cont} vs ${reb})`);
  console.log(`✓ contention: contender $${cont} > rebuilder $${reb} (same player, Week 12)`);

  // SEASON PHASE matters: a contender empties the tank late vs. hoards early (same upgrade).
  const early = plan(S, wr(4000), { roster: ROSTER, week: 2, outlook: 'Win-now window' }).target;
  const endgame = plan(S, wr(4000), { roster: ROSTER, week: 16, outlook: 'Win-now window' }).target;
  assert(endgame > early, `contender spends more late than early (endgame ${endgame} > early ${early})`);
  console.log(`✓ season phase: contender endgame $${endgame} > early $${early}`);

  // ROSTER FIT matters: an upgrade (beats your worst starter) outbids a bench flyer, all else equal.
  const fitCtx = { roster: ROSTER, week: 8, outlook: 'Balanced' };
  const upgrade = plan(S, wr(4000), fitCtx).target; // > 3000 starter → upgrade
  const flyer = plan(S, wr(800), fitCtx).target; // well behind → depth
  assert(upgrade > flyer, `a lineup upgrade outbids a bench flyer (${upgrade} vs ${flyer})`);
  console.log(`✓ roster fit: upgrade $${upgrade} > bench flyer $${flyer}`);

  // A positional HOLE (you start nobody there) is treated as a full-worth need.
  const holePlan = plan(S, { position: 'PK', value: 200, trend: 0 }, { roster: ROSTER, week: 8, outlook: 'Balanced' });
  assert(/hole/i.test(holePlan.rationale), `a positional hole is called out, got "${holePlan.rationale}"`);
  console.log(`✓ positional hole rationale: "${holePlan.rationale}"`);

  console.log('\nFAAB BID MODEL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
