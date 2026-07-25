'use strict';
// The Players screen must be able to FILTER to kickers and defenses (streaming K/DEF is a real
// strategy). Kickers are stored under the canonical position "PK", so a filter of "K" (what a user
// thinks of a kicker as) has to normalize and still match — the bug was an exact "K" compare that
// returned nothing. Defenses ("DEF") already matched.
process.env.MFL_DEMO_MODE = 'true';

const hub = require('../../src/services/playerhub');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const TOKEN = 'pos-filter-token';

(async () => {
  // search: "K" must surface kickers (stored as PK); "DEF" surfaces defenses.
  const k = await hub.search('ck', TOKEN, { position: 'K', status: 'available' });
  assert(k.players.length > 0, 'searching position "K" returns kickers (normalized to PK)');
  assert(k.players.every((p) => p.position === 'PK'), `every "K" result is a kicker, got ${JSON.stringify([...new Set(k.players.map((p) => p.position))])}`);

  const pk = await hub.search('ck', TOKEN, { position: 'PK', status: 'available' });
  assert(pk.players.length === k.players.length, 'the canonical "PK" filter matches the "K" filter');

  const def = await hub.search('ck', TOKEN, { position: 'DEF', status: 'available' });
  assert(def.players.length > 0 && def.players.every((p) => p.position === 'DEF'), 'searching "DEF" returns defenses');
  console.log(`✓ search filter: K→${k.players.length} kickers, DEF→${def.players.length} defenses`);

  // rankings: same normalization, so a kicker/defense value ranking narrows correctly.
  const rk = await hub.rankings('ck', TOKEN, { type: 'value', position: 'K' });
  assert(rk.players.length > 0 && rk.players.every((p) => p.position === 'PK'), 'rankings position "K" narrows to kickers');
  console.log(`✓ rankings filter: K→${rk.players.length} kickers`);

  console.log('\nPLAYERHUB POSITION FILTER HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
