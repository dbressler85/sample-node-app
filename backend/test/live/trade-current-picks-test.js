'use strict';
// Current-year (upcoming-draft) picks must be tradeable in the builder/counter. They live in
// the draft order (DP_ tokens), NOT MFL's futureDraftPicks export, so the builder used to miss
// them — you couldn't offer or ask for a 2026 pick for a draft that hadn't happened. This locks
// the fix: both sides' current-year picks appear as pick assets with slot-aware values.

process.env.MFL_DEMO_MODE = 'true';

const cfg = require('../../src/config');
const draft = require('../../src/services/draft');
const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // 64097 is a fully-unstarted 4-round draft in the demo → every slot is a tradeable current-year pick.
  const byFr = await draft.upcomingPicksByFranchise('ck', 'tok', { leagueId: '64097', franchiseId: '0003' });
  const franchises = Object.keys(byFr);
  assert(franchises.length >= 2, `multiple franchises hold current-year picks, got ${franchises.length}`);
  const sample = byFr[franchises[0]][0];
  assert(/^DP_\d+_\d+$/.test(sample.token), `pick carries a DP_ token, got ${sample.token}`);
  assert(sample.label.startsWith(String(cfg.season)), `label is a current-season pick, got ${sample.label}`);

  const desk = await trades.getLeague('ck', 'tok', '64097');
  const myPickNames = desk.myPicks.filter((p) => p.kind === 'pick').map((p) => p.name);
  // My current-year picks show first (this-season labels), each with a value.
  const currentYear = desk.myPicks.filter((p) => p.name.startsWith(String(cfg.season)));
  assert(currentYear.length > 0, `my current-year picks are tradeable, got ${JSON.stringify(myPickNames)}`);
  assert(currentYear.every((p) => p.value > 0), 'each current-year pick carries a slot-aware value');
  // A round-1 current pick outvalues a round-4 one.
  const r1 = currentYear.find((p) => /\s1\.\d/.test(p.name));
  const r4 = currentYear.find((p) => /\s4\.\d/.test(p.name));
  if (r1 && r4) assert(r1.value > r4.value, 'an early current-year pick is worth more than a late one');

  // Partners' current-year picks are askable in a counter too.
  const partnerHasCurrent = desk.partners.some((pt) => (pt.players || []).some((a) => a.kind === 'pick' && a.name.startsWith(String(cfg.season))));
  assert(partnerHasCurrent, 'a partner also exposes current-year picks to ask for');

  console.log(`✓ current-year picks tradeable: ${currentYear.length} of mine (e.g. ${currentYear[0].name}), partners too`);
  console.log('\nTRADE CURRENT PICKS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
