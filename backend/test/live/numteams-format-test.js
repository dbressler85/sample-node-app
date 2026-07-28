'use strict';
// League-size-aware values. FantasyCalc prices by team count (a 10-team league values depth
// differently than a 14/16), so we pass the league's franchise count as `numTeams`. This proves:
// (1) numTeams reaches the FantasyCalc URL; (2) different sizes are cached separately and can carry
// different values; (3) an odd size buckets to the nearest served size; (4) a missing size defaults to 12.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const mfl = require('../../src/lib/mfl');
mfl.exportRequest = async (type) => (type === 'players' ? { players: { player: [] } } : {}); // topOwns/topAdds empty

// Capture every FantasyCalc URL requested, and return a size-dependent value so we can prove the
// snapshot for a 16-team league differs from a 10-team one.
const urls = [];
global.fetch = async (url) => {
  const s = String(url);
  if (/fantasycalc/.test(s)) {
    urls.push(s);
    const teams = Number((/numTeams=(\d+)/.exec(s) || [])[1]) || 0;
    // Anchor at 10000; a second player whose value rises with league size (scarcer = more valuable).
    const rows = [
      { player: { mflId: '100', sleeperId: 's100', position: 'QB', name: 'Anchor', maybeAge: 25 }, value: 10000, overallRank: 1 },
      { player: { mflId: '200', sleeperId: 's200', position: 'RB', name: 'Depth', maybeAge: 26 }, value: 100 * teams, overallRank: 2 },
    ];
    return { ok: true, status: 200, json: async () => rows };
  }
  return { ok: true, status: 200, json: async () => [] };
};

const enrichment = require('../../src/lib/enrichment');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const ten = await enrichment.snapshot({ numQbs: 1, ppr: 1, tePpr: 1, numTeams: 10 }, 'ck');
  const sixteen = await enrichment.snapshot({ numQbs: 1, ppr: 1, tePpr: 1, numTeams: 16 }, 'ck');

  // 1) numTeams reaches the URL.
  assert(urls.some((u) => /numTeams=10/.test(u)), `10-team request carries numTeams=10 (urls: ${urls.join(' , ')})`);
  assert(urls.some((u) => /numTeams=16/.test(u)), 'a 16-team request carries numTeams=16');
  console.log('✓ league size reaches the FantasyCalc URL (numTeams=10 and =16 both requested)');

  // 2) different sizes are cached separately and carry different values (depth player worth more in 16).
  const d10 = ten.value('200');
  const d16 = sixteen.value('200');
  assert(d16 > d10, `depth player is worth more in a 16-team league (${d16}) than a 10-team one (${d10})`);
  console.log(`✓ size-aware values: depth player 10-team=${d10} < 16-team=${d16}`);

  // 3) an off-list size buckets to the nearest served size (7 → 8; a still-cold bucket, so it fetches).
  urls.length = 0;
  await enrichment.snapshot({ numQbs: 1, ppr: 1, tePpr: 1, numTeams: 7 }, 'ck');
  assert(urls.some((u) => /numTeams=8/.test(u)), `7 buckets to the nearest served size 8 (urls: ${urls.join(' , ')})`);
  console.log('✓ off-list size 7 buckets to nearest served size (8)');

  // 4) a missing size defaults to 12.
  urls.length = 0;
  await enrichment.snapshot({ numQbs: 1, ppr: 1, tePpr: 1 }, 'ck2'); // new cookie → cold cache → real fetch
  assert(urls.some((u) => /numTeams=12/.test(u)), `missing size defaults to 12 (urls: ${urls.join(' , ')})`);
  console.log('✓ missing size defaults to 12 teams');

  console.log('\nNUMTEAMS FORMAT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
