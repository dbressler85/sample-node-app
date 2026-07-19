'use strict';
// Data-integration hardening (audit #17-#20):
//  #17 ownership/adds parse from alternate MFL field names (not just 'percent').
//  #18 ESPN news skips ambiguous namesakes instead of mis-attributing.
//  #19 future-pick tokens use MFL's real `originalPickFor` (acquired picks got
//      the wrong owner before); own picks fall back to the listing franchise.
//  #20 starting slots are named superflex/flex precisely; range limits are read.
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'Star, Player', position: 'WR', team: 'AAA' },
  { id: '10', name: 'Williams, Mike', position: 'WR', team: 'BBB' }, // namesake
  { id: '11', name: 'Williams, Mike', position: 'WR', team: 'CCC' }, // namesake
  { id: '12', name: 'Jefferson, Justin', position: 'WR', team: 'DDD' },
];
const ESPN_ARTICLES = [
  { id: 'a1', headline: 'Mike Williams questionable', description: '', categories: [{ type: 'athlete', athlete: { displayName: 'Mike Williams' } }] },
  { id: 'a2', headline: 'Justin Jefferson ruled out', description: '', categories: [{ type: 'athlete', athlete: { displayName: 'Justin Jefferson' } }] },
];

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'players':
      return { players: { player: PLAYERS } };
    case 'topOwns': // 'owned' field, not 'percent'
      return { topOwns: { player: [{ id: '1', owned: '42.5' }] } };
    case 'topAdds':
      return { topAdds: { player: [{ id: '1', adds: '1200' }] } };
    case 'league':
      return { league: { starters: { position: [
        { name: 'QB', limit: '1' },
        { name: 'QB|RB|WR|TE', limit: '1' }, // superflex
        { name: 'RB|WR|TE', limit: '1-2' }, // flex, range limit -> max 2
        { name: 'RB|WR', limit: '1' }, // W/R
      ] } } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [
        { year: '2027', round: '1', originalPickFor: '0005' }, // acquired from 0005
        { year: '2027', round: '2' }, // own pick — no original-owner field
      ] } } };
    default:
      return {};
  }
};
global.fetch = async (url) => {
  if (String(url).includes('fantasycalc')) return { ok: true, json: async () => [{ player: { mflId: '1', sleeperId: 's1', maybeAge: 25 }, value: 9000, overallRank: 1 }] };
  if (String(url).includes('espn')) return { ok: true, json: async () => ({ articles: ESPN_ARTICLES }) };
  return { ok: true, json: async () => [] };
};

const enrichment = require('../../src/lib/enrichment');
const news = require('../../src/lib/news');
const picks = require('../../src/lib/picks');
const leagueFormat = require('../../src/lib/leagueformat');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const CK = 'ck';
const LG = { leagueId: 'L1', host: 'h', franchiseId: '0001' };

(async () => {
  // #17 — ownership parses from the 'owned' field (not just 'percent').
  const enr = await enrichment.snapshot({ numQbs: 1, ppr: 1 }, CK);
  console.log('ownership(1):', enr.ownership('1'), 'trend(1):', enr.trend('1'));
  assert(enr.ownership('1') === 42.5, `ownership from 'owned' field, got ${enr.ownership('1')}`);
  assert(enr.trend('1') >= 1200, `adds from 'adds' field folded into trend, got ${enr.trend('1')}`);
  console.log('✓ #17 ownership/adds parse from alternate field names');

  // #18 — ambiguous namesake is skipped; unique name matches.
  const items = await news.mflNews(CK);
  console.log('news items:', JSON.stringify(items.map((i) => i.playerId)));
  assert(items.length === 1 && items[0].playerId === '12', 'only the unambiguous Jefferson news is kept');
  assert(!items.some((i) => i.playerId === '10' || i.playerId === '11'), 'ambiguous "Mike Williams" not mis-attributed');
  console.log('✓ #18 ESPN news skips ambiguous namesakes');

  // #19 — acquired pick uses originalPickFor; own pick falls back to franchise.
  const fp = await picks.franchisePicks(CK, LG);
  console.log('picks:', JSON.stringify(fp));
  const acq = fp.find((p) => p.label === '2027 1st');
  const own = fp.find((p) => p.label === '2027 2nd');
  assert(acq.token === 'FP_0005_2027_1' && acq.originalKnown === true, `acquired pick token from originalPickFor, got ${acq.token}`);
  assert(own.token === 'FP_0001_2027_2' && own.originalKnown === false, `own pick falls back to franchise, got ${own.token}`);
  console.log('✓ #19 future-pick tokens use the real originalPickFor field');

  // #20 — slots named precisely; range limit read as max.
  const reqs = await leagueFormat.requirements(CK, LG);
  console.log('slots:', JSON.stringify(reqs.map((r) => `${r.name}:${r.count}`)));
  const names = reqs.map((r) => r.name);
  assert(names.includes('SUPERFLEX'), 'QB-eligible flex named SUPERFLEX');
  assert(names.includes('FLEX'), 'RB/WR/TE named FLEX');
  assert(names.includes('W/R'), 'RB/WR named W/R');
  assert(reqs.find((r) => r.name === 'FLEX').count === 2, 'range limit "1-2" read as max 2');
  assert(leagueFormat.numQbs(reqs) === 2, 'superflex detected (QB + SUPERFLEX slots)');
  console.log('✓ #20 precise slot naming + range-limit handling');

  console.log('\nPARSE-HARDENING TEST PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
