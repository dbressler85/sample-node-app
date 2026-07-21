'use strict';
// The Rookies ranking must show the CURRENT NFL draft class (draft_year === season), not
// "anyone young". Age alone wrongly swept in 2nd/3rd-year players; this locks the fix.

process.env.MFL_DEMO_MODE = 'true';

const cfg = require('../../src/config');
const players = require('../../src/lib/players');
const hub = require('../../src/services/playerhub');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const byId = await players.load('ck');
  // The demo fixture marks 19xxx as this season's class and 16xxx as last year's.
  const rookieIds = ['19001', '19002', '19003', '19004', '19005', '19006'];
  const sophomoreIds = ['16001', '16002', '16003'];
  for (const id of rookieIds) assert(byId.get(id).draftYear === cfg.season, `demo rookie ${id} carries draftYear === season`);
  for (const id of sophomoreIds) assert(byId.get(id).draftYear === cfg.season - 1, `demo sophomore ${id} is last year's class`);

  const r = await hub.rankings('ck', 'tok', { type: 'rookies' });
  const ids = new Set(r.players.map((p) => String(p.id)));
  assert(r.players.length > 0, 'the rookie class is non-empty');
  assert([...ids].every((id) => rookieIds.includes(id)), `only the current draft class appears, got ${[...ids].join(',')}`);
  assert(!ids.has('16001'), 'a second-year player does NOT show under Rookies');

  console.log(`✓ rookies = current draft class only (${r.players.length} players, no sophomores)`);
  console.log('\nROOKIES FILTER HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
