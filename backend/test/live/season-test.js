'use strict';
// Time-of-year trade advisory (advisory only). Draft season favors holding picks;
// the NFL season favors holding veterans; summer is neutral.
const { advisory } = require('../../src/lib/season');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const draft = advisory(new Date('2026-03-15T12:00:00Z'));
  assert(draft.window === 'draft-season' && draft.holdToSell === 'picks', 'March is draft season (picks at peak)');
  // Draft season is the peak of the pick market — the window to SELL picks, not hold.
  assert(/sell picks/i.test(draft.message), 'draft season advises selling picks into their peak');

  const inSeason = advisory(new Date('2026-10-05T12:00:00Z'));
  assert(inSeason.window === 'in-season' && inSeason.holdToSell === 'vets', 'October is in-season (vets peak)');
  // In-season picks are climbing toward their winter peak — hold, don't sell cheap.
  assert(!/sell picks/i.test(inSeason.message) && /pick/i.test(inSeason.message), 'in-season holds picks as they climb (never sells them)');

  const champ = advisory(new Date('2026-01-10T12:00:00Z'));
  assert(champ.window === 'in-season', 'January (playoffs) still reads in-season');

  const off = advisory(new Date('2026-06-20T12:00:00Z'));
  assert(off.window === 'offseason' && off.holdToSell === null, 'June is the quiet offseason');

  // Late July = training camp: depth charts firm up, so it reads distinctly from June.
  const camp = advisory(new Date('2026-07-28T12:00:00Z'));
  assert(camp.window === 'preseason' && camp.holdToSell === null, 'late July is training camp (a buy-low window, nothing at peak)');
  assert(/depth charts|blocked/i.test(camp.message), 'camp advisory speaks to depth-chart firming');
  // The correction: summer picks are near their LOW and sliding — training camp must NOT say to
  // sell picks; it should say to buy them cheap.
  assert(!/sell picks/i.test(camp.message), 'training camp does NOT advise selling picks (they sit near their summer low)');
  assert(/buy them cheap|buy picks|near their summer low/i.test(camp.message), 'training camp frames picks as a summer-low buy');

  // Domain rule across the whole summer dip (May–Aug): never advise selling picks into the slide.
  for (let mo = 5; mo <= 8; mo += 1) {
    const a = advisory(new Date(`2026-${String(mo).padStart(2, '0')}-15T12:00:00Z`));
    assert(!/sell picks/i.test(a.message), `month ${mo} (summer pick dip) must not advise selling picks`);
  }

  for (const a of [draft, inSeason, champ, off]) {
    assert(a.label && a.message, 'each advisory carries a label + message');
  }
  console.log('✓ seasonal advisory: picks sell in the Jan→draft peak, buy in the summer dip, hold as they climb in-season');
  console.log('\nSEASON HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
