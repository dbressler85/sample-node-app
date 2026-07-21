'use strict';
// Time-of-year trade advisory (advisory only). Draft season favors holding picks;
// the NFL season favors holding veterans; summer is neutral.
const { advisory } = require('../../src/lib/season');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const draft = advisory(new Date('2026-03-15T12:00:00Z'));
  assert(draft.window === 'draft-season' && draft.holdToSell === 'picks', 'March is draft season (hold picks)');

  const inSeason = advisory(new Date('2026-10-05T12:00:00Z'));
  assert(inSeason.window === 'in-season' && inSeason.holdToSell === 'vets', 'October is in-season (hold vets)');

  const champ = advisory(new Date('2026-01-10T12:00:00Z'));
  assert(champ.window === 'in-season', 'January (playoffs) still reads in-season');

  const off = advisory(new Date('2026-06-20T12:00:00Z'));
  assert(off.window === 'offseason' && off.holdToSell === null, 'June is the quiet offseason');

  // Late July = training camp: depth charts firm up, so it reads distinctly from June.
  const camp = advisory(new Date('2026-07-28T12:00:00Z'));
  assert(camp.window === 'preseason' && camp.holdToSell === 'vets', 'late July is training camp (starters firm, picks slide)');
  assert(/depth charts|blocked/i.test(camp.message), 'camp advisory speaks to depth-chart firming');

  for (const a of [draft, inSeason, champ, off]) {
    assert(a.label && a.message, 'each advisory carries a label + message');
  }
  console.log('✓ seasonal advisory: draft→hold picks, in-season→hold vets, summer→neutral');
  console.log('\nSEASON HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
