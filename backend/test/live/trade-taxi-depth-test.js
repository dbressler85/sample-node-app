'use strict';
// The reported bug: trading Mark Andrews read as "Leaves you with no startable TE — don't do it" even
// though the owner ALSO rostered Brock Bowers + a rookie TE (Kenyon Siddiq) — the rookie stashed on the
// TAXI squad. Root cause: the trade desk built MY franchise's positional model from starters+bench
// ONLY, dropping IR + taxi, while every PARTNER's model used their full MFL roster. So my own depth was
// undercounted and hole detection saw one fewer TE than I actually had. The fix counts my whole roster
// (starters + bench + IR + taxi) like partners' — this test locks it against the demo fixture, whose
// franchise 64097 stashes a WR on IR (Olave) and a WR on the taxi squad (Odunze).
process.env.MFL_DEMO_MODE = 'true';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const trades = require('../../src/services/trades');
const rosterService = require('../../src/services/roster');

const COOKIE = 'demo';
const TOKEN = 'demo-token';
const L = '64097';

(async () => {
  // Sanity on the fixture: this league genuinely stashes a WR on IR AND a WR on taxi, so the two
  // buckets the old model dropped both hold a real body at the same position.
  const roster = await rosterService.getRoster(COOKIE, L);
  const wrIn = (bucket) => (roster[bucket] || []).filter((p) => p.position === 'WR');
  assert(wrIn('ir').length >= 1, 'demo 64097 has a WR on IR (the old model dropped it)');
  assert(wrIn('taxi').length >= 1, 'demo 64097 has a WR on the taxi squad (the old model dropped it)');
  const allWr = [...wrIn('starters'), ...wrIn('bench'), ...wrIn('ir'), ...wrIn('taxi')];
  console.log(`✓ fixture: ${allWr.length} WR bodies across all buckets (${wrIn('ir').length} IR, ${wrIn('taxi').length} taxi)`);

  const league = await trades.getLeague(COOKIE, TOKEN, L);
  const wrDepth = league.me.depth.WR;
  assert(wrDepth, 'my WR depth is present in the trade-desk model');
  // The whole-roster fix: WR bodies now count every rostered WR — starters, bench, IR, AND taxi — so a
  // stashed body is no longer invisible to hole detection. Pre-fix this equalled only the starters+bench
  // count (2 fewer here), which is exactly how trading a startable body read as "no startable WR".
  assert(
    wrDepth.bodies === allWr.length,
    `WR bodies must count starters+bench+IR+taxi (${allWr.length}), got ${wrDepth.bodies}`
  );
  console.log(`✓ trade desk counts all ${wrDepth.bodies} WR bodies — the IR + taxi stashes are no longer dropped`);

  console.log('\nTRADE TAXI/IR DEPTH HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
