'use strict';

// Target/Avoid personal-value overlay on trades: the personal analysis re-scores the deal
// through your tags (Target ×1.10, Avoid ×0.90) while market value is untouched, and the
// tag notes flag the human-meaningful cases.

process.env.MFL_DEMO_MODE = 'true';

const trades = require('../../src/services/trades');
const tradefit = require('../../src/lib/tradefit');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// A dead-even market deal: I get p1 (60), I give p2 (60).
const acquire = [{ kind: 'player', id: 'p1', position: 'WR', value: 60 }];
const send = [{ kind: 'player', id: 'p2', position: 'RB', value: 60 }];

(async () => {
  // Market is even.
  assert(trades.analyze(acquire, send).net === 0, 'market: even deal nets 0');

  // The net is the real signal (the ±10% ratio stays under the "favorable" band on an
  // even deal, so the verdict may stay 'fair' — that's expected; the tilt shows in net).
  // Acquiring a Target: his value ×1.10 → you come out ahead.
  assert(trades.personalAnalyze([{ ...acquire[0], tag: 'target' }], send).net === 6, 'acquiring a Target (60→66) → net +6 for you');
  // Giving a Target: costs you more → you come out behind (don't deal him at even).
  assert(trades.personalAnalyze(acquire, [{ ...send[0], tag: 'target' }]).net === -6, 'sending a Target → net −6 for you');
  // Giving an Avoid: good riddance → you come out ahead.
  assert(trades.personalAnalyze(acquire, [{ ...send[0], tag: 'avoid' }]).net === 6, 'sending an Avoid (60→54) → net +6 for you');
  // Acquiring an Avoid: you value him less → behind.
  assert(trades.personalAnalyze([{ ...acquire[0], tag: 'avoid' }], send).net === -6, 'acquiring an Avoid → net −6 for you');

  // Market value is never touched by tags.
  assert(trades.analyze([{ ...acquire[0], tag: 'target' }], send).net === 0, 'market analysis ignores tags (still even)');

  // No tags → null (UI shows nothing extra).
  assert(trades.personalAnalyze(acquire, send) === null, 'untagged deal → no personal overlay');

  // Notes.
  const notes = trades.tagNotes([{ ...acquire[0], tag: 'avoid' }], [{ ...send[0], tag: 'target' }]);
  assert(notes.some((n) => n.level === 'caution' && /Target of yours/.test(n.text)), 'flags "they want a Target of yours"');
  assert(notes.some((n) => n.level === 'caution' && /Avoid/.test(n.text)), 'flags taking on an Avoid');

  // Suggestion bias: among equal-value givers, ship the Avoid and protect the Target.
  const givers = [
    { id: 'a', position: 'RB', value: 50, tag: 'avoid' },
    { id: 'b', position: 'RB', value: 50, tag: 'target' },
    { id: 'c', position: 'RB', value: 50 },
  ];
  const give = tradefit.suggestGive(givers, 50, [], new Set());
  assert(give.length === 1 && give[0].id === 'a', 'suggestGive ships the Avoid (a), not the plain or the Target');
  // The Target is the last resort — only picked when it's the sole option.
  const onlyTarget = tradefit.suggestGive([{ id: 'b', position: 'RB', value: 50, tag: 'target' }], 50, [], new Set());
  assert(onlyTarget[0].id === 'b', 'a Target is still used when it is the only fair option (protected, not untouchable)');

  console.log('✓ trade tags: personal re-score (all 4 directions), null when untagged, notes, suggestion bias');
  console.log('\nTRADE TAGS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
