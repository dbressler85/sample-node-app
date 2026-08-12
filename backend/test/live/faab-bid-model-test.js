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

  // ── Tier 2 ────────────────────────────────────────────────────────────────────────────────────
  const base2 = { roster: ROSTER, week: 8, outlook: 'Win-now window' };
  const wrId = { id: 'fa1', position: 'WR', value: 4000, trend: 0 }; // dynasty upgrade over the 3000 starter

  // #7 league size: a deeper league (more rivals who can outbid) raises the price to WIN.
  const t10 = plan(S, wrId, { ...base2, teams: 10 }).target;
  const t16 = plan(S, wrId, { ...base2, teams: 16 }).target;
  assert(t16 > t10, `bigger league bids higher to win (16-team ${t16} > 10-team ${t10})`);
  console.log(`✓ league size: 16-team $${t16} > 10-team $${t10}`);

  // #6 win-now lens: a dynasty-valued but redraft-weak stash (a rookie) is NOT a win-now FAAB
  // priority. Scoring fit in the win-now lens (nowValueOf) drops it from "upgrade" to a flyer.
  const nowLens = (id) => (id === 'fa1' ? 10 : id === 's1' ? 60 : id === 's2' ? 55 : null); // add is redraft-weak
  const dynastyView = plan(S, wrId, base2).target; // no lens → dynasty says "upgrade"
  const winNowView = plan(S, wrId, { ...base2, nowValueOf: nowLens }).target; // lens says "flyer"
  assert(winNowView < dynastyView, `redraft-weak stash bids less in the win-now lens (${winNowView} < ${dynastyView})`);
  console.log(`✓ win-now lens: redraft-weak stash $${winNowView} < dynasty view $${dynastyView}`);

  // #5 scarcity: the same pickup costs more when the wire has no comparable body behind him.
  const strongNow = (id) => (id === 'fa1' ? 70 : 60); // he's a real win-now piece
  const scarce = plan(S, wrId, { ...base2, nowValueOf: strongNow, nextBestNow: 20 }).target; // nothing close behind
  const plentiful = plan(S, wrId, { ...base2, nowValueOf: strongNow, nextBestNow: 68 }).target; // a near-equal waits
  assert(scarce > plentiful, `scarce pickup bids more than a replaceable one (${scarce} > ${plentiful})`);
  console.log(`✓ scarcity: scarce $${scarce} > replaceable $${plentiful}`);

  // #1 VALUE CEILING (the real-build complaint: "suggesting I spend 20–50% of budget on fringe
  // pickups"). A fringe FA — low win-now value — must stay a token bid even for a contender in the
  // endgame, when every other lever (posture, phase) is maxed. The value ceiling is what stops the
  // budget-fraction math from handing a flyer a difference-maker's share.
  const fringeNow = (id) => (id === 'fa1' ? 8 : id === 's1' ? 60 : id === 's2' ? 55 : null);
  const fringeContenderLate = plan(S, wrId, { roster: ROSTER, week: 16, outlook: 'Win-now window', nowValueOf: fringeNow }).max;
  assert(fringeContenderLate <= 12, `fringe pickup stays a token bid even for a contender in the endgame, got max $${fringeContenderLate} (>12% of budget)`);
  console.log(`✓ value ceiling: fringe contender/endgame max $${fringeContenderLate} ≤ $12 (was 20–50% of budget)`);

  // …and a genuine win-now difference-maker is NOT capped down to a token — the ceiling scales with
  // value, so a 60-value piece still commands a real bid. (Guards against over-correcting #1.)
  const stud = plan(S, wrId, { roster: ROSTER, week: 16, outlook: 'Win-now window', nowValueOf: strongNow }).target;
  assert(stud >= 20, `a real win-now difference-maker still commands a real bid, got $${stud}`);
  assert(stud > fringeContenderLate * 2, `stud bids well above a fringe flyer ($${stud} vs $${fringeContenderLate})`);
  console.log(`✓ value scales: difference-maker $${stud} ≫ fringe $${fringeContenderLate} (same posture/phase)`);

  console.log('\nFAAB BID MODEL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
