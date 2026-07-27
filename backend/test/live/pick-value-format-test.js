'use strict';
// Format-aware pick values. FantasyCalc lists draft picks alongside players (position "PICK"),
// FORMAT-AWARE and per-slot, keyed by our own token scheme (mflId "DP_0_0" = "2026 1.01"). picks.value
// now prefers that value when given the enrichment snapshot, falling back to the local curve only when
// FC doesn't cover a pick. This proves: (1) a current-draft pick uses FC's value via the token join;
// (2) it's format-aware (SF > 1QB); (3) a future pick resolves via the round-level label fallback; and
// (4) an uncovered pick falls back to the local curve.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const mfl = require('../../src/lib/mfl');
mfl.exportRequest = async (type) => (type === 'players' ? { players: { player: [] } } : {}); // topOwns/topAdds empty

// FantasyCalc rows per format. A max-value player anchors normalization (÷ maxVal × 100), a current-draft
// pick keyed by our DP token, and a future pick with NO mflId (so it exercises the label/round fallback).
const FC = (numQbs) => [
  { player: { mflId: '100', sleeperId: 's100', position: 'QB', name: 'Anchor QB', maybeAge: 25 }, value: 10000, overallRank: 1 },
  { player: { mflId: 'DP_0_0', sleeperId: 'DP_0_0', position: 'PICK', name: '2026 Pick 1.01' }, value: numQbs === 2 ? 8000 : 3500 },
  { player: { mflId: '', sleeperId: '', position: 'PICK', name: '2027 Pick 1.03' }, value: numQbs === 2 ? 5000 : 2200 },
];
global.fetch = async (url) => {
  if (/fantasycalc/.test(String(url))) {
    const numQbs = /numQbs=2/.test(String(url)) ? 2 : 1;
    return { ok: true, status: 200, json: async () => FC(numQbs) };
  }
  return { ok: true, status: 200, json: async () => [] };
};

const enrichment = require('../../src/lib/enrichment');
const picks = require('../../src/lib/picks');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const sf = await enrichment.snapshot({ numQbs: 2, ppr: 1, tePpr: 1 }, 'ck');
  const oneQb = await enrichment.snapshot({ numQbs: 1, ppr: 1, tePpr: 1 }, 'ck');

  // Normalized: 8000/10000×100 = 80 (SF), 3500/10000×100 = 35 (1QB). Curve for 1.01 is 70.
  const curve101 = picks.value('2026 1.01'); // no enr → local curve
  console.log('1.01:', { fcSF: sf.pickValue('2026 1.01', 'DP_0_0'), fc1QB: oneQb.pickValue('2026 1.01', 'DP_0_0'), curve: curve101 });

  // 1) token join — the current-draft pick uses FantasyCalc's value, not the curve.
  assert(sf.pickValue('2026 1.01', 'DP_0_0') === 80, `SF 1.01 = FC value 80, got ${sf.pickValue('2026 1.01', 'DP_0_0')}`);
  assert(picks.value('2026 1.01', 'DP_0_0', sf) === 80 && picks.value('2026 1.01', 'DP_0_0', sf) !== curve101, 'picks.value uses the FC value over the curve when enr is supplied');

  // 2) format-aware — the same pick is worth more in Superflex than in 1QB.
  assert(sf.pickValue('2026 1.01', 'DP_0_0') > oneQb.pickValue('2026 1.01', 'DP_0_0'), `SF pick > 1QB pick (${sf.pickValue('2026 1.01', 'DP_0_0')} vs ${oneQb.pickValue('2026 1.01', 'DP_0_0')})`);
  console.log('✓ current-draft pick is format-aware from FantasyCalc (SF 80 > 1QB 35), not the flat curve');

  // 3) future pick — our FP token won't match FC's key, but the "2027 1st" label resolves via the
  // round-level FC average (from "2027 Pick 1.03" = 5000/10000×100 = 50).
  assert(picks.value('2027 1st', 'FP_0001_2027_1', sf) === 50, `future 1st resolves via round fallback to 50, got ${picks.value('2027 1st', 'FP_0001_2027_1', sf)}`);
  console.log('✓ future pick resolves via the round-level FantasyCalc average');

  // 4) uncovered pick — FC has nothing for it → the local curve, unchanged.
  const uncovered = picks.value('2099 4th', 'FP_0001_2099_4', sf);
  assert(uncovered === picks.value('2099 4th'), `an FC-uncovered pick falls back to the curve, got ${uncovered} vs curve ${picks.value('2099 4th')}`);
  console.log('✓ FC-uncovered picks fall back to the local curve (non-regression)');

  console.log('\nPICK VALUE FORMAT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
