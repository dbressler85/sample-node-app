'use strict';
// Verify FantasyCalc values are format-aware: a QB is worth more in superflex
// (numQbs=2) than 1QB, and leagueFormat detects superflex from the lineup slots.
process.env.MFL_DEMO_MODE = 'false';

// FantasyCalc returns a bigger QB value when numQbs=2 (URL carries the param).
global.fetch = async (url) => {
  let data = [];
  if (url.includes('fantasycalc')) {
    const sf = /numQbs=2/.test(url);
    data = [
      { player: { mflId: 'QB1', sleeperId: 'sq', maybeAge: 25 }, value: sf ? 9500 : 3000, overallRank: sf ? 1 : 20 },
      { player: { mflId: 'WR1', sleeperId: 'sw', maybeAge: 24 }, value: 9000, overallRank: sf ? 2 : 1 },
    ];
  } else if (url.includes('sleeper')) {
    data = [];
  }
  return { ok: true, json: async () => data };
};

const enrichment = require('../../src/lib/enrichment');
const leagueFormat = require('../../src/lib/leagueformat');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // Superflex detection from lineup requirements.
  const oneQb = [{ name: 'QB', eligible: ['QB'], count: 1 }, { name: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 }];
  const superflex = [{ name: 'QB', eligible: ['QB'], count: 1 }, { name: 'SUPERFLEX', eligible: ['QB', 'RB', 'WR', 'TE'], count: 1 }];
  const twoQb = [{ name: 'QB', eligible: ['QB'], count: 2 }];
  assert(leagueFormat.numQbs(oneQb) === 1, '1QB detected');
  assert(leagueFormat.numQbs(superflex) === 2, 'superflex detected');
  assert(leagueFormat.numQbs(twoQb) === 2, '2QB detected');
  console.log('✓ format detection: 1QB / superflex / 2QB');

  // Value is format-aware: QB normalized higher under superflex.
  const std = await enrichment.snapshot({ numQbs: 1, ppr: 1 });
  const sf = await enrichment.snapshot({ numQbs: 2, ppr: 1 });
  const qbStd = std.value('QB1');
  const qbSf = sf.value('QB1');
  console.log(`QB value: 1QB=${qbStd}, superflex=${qbSf}`);
  assert(qbStd === 33, `1QB value 33 (3000/9000), got ${qbStd}`);
  assert(qbSf === 100, `superflex value 100 (9500 max), got ${qbSf}`);
  assert(qbSf > qbStd, 'QB worth more in superflex');
  // WR roughly stable across formats (9000 both).
  assert(std.value('WR1') === 100 && sf.value('WR1') === 95, 'WR value stable-ish across formats');
  console.log('✓ FantasyCalc values are format-aware (QB 33 -> 100 from 1QB to superflex)');

  console.log('\nFORMAT-AWARE ENRICHMENT TEST PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
