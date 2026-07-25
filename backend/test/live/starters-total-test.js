'use strict';
// A min-max lineup ("start 1 QB, up to 3 RB, up to 5 WR, 1 TE, 1 K, 1 DEF, 10 total") must surface
// the AUTHORITATIVE total number of starters (MFL's `starters count`), which is LESS than the sum of
// the per-position maximums (1+3+5+1+1+1 = 12 maxes, but only 10 start). Each slot keeps its min/max
// so the UI can say "up to 3", and the label + totalStarters read honestly everywhere they appear.
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// MFL `league` export with a min-max starters block. `count` = 10 is the real total.
mfl.exportRequest = async (type) => {
  if (type === 'league') {
    return { league: { starters: {
      count: '10',
      position: [
        { name: 'QB', limit: '1' },
        { name: 'RB', limit: '1-3' },
        { name: 'WR', limit: '1-5' },
        { name: 'TE', limit: '1' },
        { name: 'PK', limit: '1' },
        { name: 'DEF', limit: '1' },
      ],
    } } };
  }
  if (type === 'rules') return {};
  return {};
};

const leagueFormat = require('../../src/lib/leagueformat');
const leagueContext = require('../../src/lib/leagueContext');
const league = { leagueId: 'L1', host: 'www10.myfantasyleague.com' };

(async () => {
  const spec = await leagueFormat.startersSpec('ck', league);
  const sumMax = spec.slots.reduce((s, r) => s + r.max, 0);
  assert(sumMax === 12, `sum of position maxes is 12, got ${sumMax}`);
  assert(spec.total === 10, `authoritative total starters is 10 (MFL count), NOT the sum of maxes, got ${spec.total}`);
  const rb = spec.slots.find((r) => r.name === 'RB');
  assert(rb.min === 1 && rb.max === 3 && rb.count === 3, `RB slot carries min 1 / max 3 (count=max), got ${JSON.stringify(rb)}`);
  const qb = spec.slots.find((r) => r.name === 'QB');
  assert(qb.min === 1 && qb.max === 1, 'a fixed slot has min === max');
  console.log(`✓ startersSpec: total=${spec.total} (sum of maxes=${sumMax}), RB is 1-3`);

  const ctx = await leagueContext.build('ck', league);
  assert(ctx.lineup.totalStarters === 10, `leagueContext totalStarters = 10, got ${ctx.lineup.totalStarters}`);
  assert(ctx.lineup.hasRange === true, 'leagueContext flags a min-max (ranged) lineup');
  assert(/≤3RB/.test(ctx.lineup.label) && /≤5WR/.test(ctx.lineup.label), `label shows ranges "≤3RB"/"≤5WR", got "${ctx.lineup.label}"`);
  assert(/1QB/.test(ctx.lineup.label) && /1TE/.test(ctx.lineup.label), 'label shows fixed slots plainly');
  console.log(`✓ leagueContext: "${ctx.lineup.label}" · ${ctx.lineup.totalStarters} total`);

  console.log('\nSTARTERS TOTAL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
