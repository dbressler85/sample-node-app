'use strict';
// Verify the enrichment provider logic: FantasyCalc value normalization + age +
// rank, and the Sleeper->MFL trending crosswalk. Stubs global fetch (no network).
process.env.MFL_DEMO_MODE = 'false';

const FC = [
  { player: { mflId: '13593', sleeperId: '6794', name: 'Justin Jefferson', maybeAge: 25, position: 'WR' }, value: 9500, overallRank: 1 },
  { player: { mflId: '15267', sleeperId: '8888', name: 'Bijan Robinson', maybeAge: 23, position: 'RB' }, value: 4750, overallRank: 10 },
  { player: { mflId: '99999', sleeperId: '7777', name: 'No Sleeper Trend', maybeAge: 30, position: 'TE' }, value: 950, overallRank: 80 },
];
const SLEEPER = [{ player_id: '8888', count: 1200 }, { player_id: '6794', count: 300 }];

global.fetch = async (url) => {
  const data = url.includes('fantasycalc') ? FC : url.includes('sleeper') ? SLEEPER : [];
  return { ok: true, json: async () => data };
};

const enrichment = require('../../src/lib/enrichment');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const snap = await enrichment.snapshot();

  // Values normalized to 0-100 by the max (9500 -> 100, 4750 -> 50, 950 -> 10).
  assert(snap.value('13593') === 100, `Jefferson value 100, got ${snap.value('13593')}`);
  assert(snap.value('15267') === 50, `Bijan value 50, got ${snap.value('15267')}`);
  assert(snap.value('99999') === 10, `fringe value 10, got ${snap.value('99999')}`);
  assert(snap.value('00000') === null, 'unknown player -> null value');

  // Age + rank straight from FantasyCalc.
  assert(snap.age('13593') === 25 && snap.age('15267') === 23, 'ages mapped');
  assert(snap.rank('13593') === 1 && snap.rank('15267') === 10, 'ranks mapped');

  // Trends via the Sleeper->MFL crosswalk (sleeperId 8888 -> mflId 15267).
  assert(snap.trend('15267') === 1200, `Bijan trend 1200, got ${snap.trend('15267')}`);
  assert(snap.trend('13593') === 300, `Jefferson trend 300 (sleeper 6794), got ${snap.trend('13593')}`);
  assert(snap.trend('99999') === 0, 'player not trending -> 0');

  // Ownership intentionally null (no free source).
  assert(snap.ownership('13593') === null, 'ownership null (no source)');

  console.log('✓ values normalized 0-100:', snap.value('13593'), snap.value('15267'), snap.value('99999'));
  console.log('✓ ages/ranks mapped; trends via Sleeper->MFL crosswalk:', snap.trend('15267'), snap.trend('13593'));
  console.log('\nENRICHMENT PROVIDER TEST PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
