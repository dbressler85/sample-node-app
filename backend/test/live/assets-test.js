'use strict';
// mflRepo.assets — every franchise's tradable assets (players, FAAB, draft picks) in one read.
// Pinned to a real sample: assets.franchise[] with players.player[], blindBiddingDollars.amount,
// and futureYearDraftPicks.draftPick[] (FP tokens encode the ORIGINAL owner; HTML in descriptions).
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');

mfl.exportRequest = async (type) => {
  if (type !== 'assets') return {};
  return { assets: { franchise: [
    { id: '0001', players: { player: [{ id: '14127' }, { id: '15253' }] }, blindBiddingDollars: { amount: '1000.00' },
      futureYearDraftPicks: { draftPick: [{ pick: 'FP_0001_2027_2', description: 'Year 2027 Round 2 Draft Pick from The Chowdah' }] } },
    // 0012 holds a pick ORIGINALLY owned by 0001 (acquired in a trade); description has HTML.
    { id: '0012', blindBiddingDollars: { amount: '1022.00' }, players: { player: [{ id: '10700' }] },
      futureYearDraftPicks: { draftPick: [
        { pick: 'FP_0012_2027_1', description: "Year 2027 Round 1 Draft Pick from <font color='#69BE28'> Sandy Piranhas </font> " },
        { pick: 'FP_0001_2027_1', description: 'Year 2027 Round 1 Draft Pick from The Chowdah' },
      ] } },
  ] } };
};

const league = { host: 'www45.myfantasyleague.com', leagueId: '69597', franchiseId: '0001' };

(async () => {
  const list = await mflRepo.assets(league, 'ck');
  const by = new Map(list.map((f) => [f.id, f]));

  const f1 = by.get('0001');
  assert(f1.playerIds.length === 2 && f1.playerIds[0] === '14127', 'players parsed');
  assert(f1.faab === 1000, `FAAB parsed to a number, got ${f1.faab}`);
  assert(f1.picks.length === 1 && f1.picks[0].token === 'FP_0001_2027_2', 'future pick token parsed');
  assert(f1.picks[0].kind === 'future' && f1.picks[0].year === 2027 && f1.picks[0].round === 2 && f1.picks[0].originalOwner === '0001', `pick token decoded, got ${JSON.stringify(f1.picks[0])}`);

  const f12 = by.get('0012');
  assert(f12.faab === 1022, 'FAAB parsed for 0012');
  // The acquired pick is listed under 0012 but its token still names 0001 as the original owner.
  const acquired = f12.picks.find((p) => p.token === 'FP_0001_2027_1');
  assert(acquired && acquired.originalOwner === '0001', 'acquired pick keeps original-owner token under the current holder');
  // HTML in the description is stripped.
  const own = f12.picks.find((p) => p.token === 'FP_0012_2027_1');
  assert(own && own.description === 'Year 2027 Round 1 Draft Pick from Sandy Piranhas' && !/</.test(own.description), `HTML stripped, got "${own && own.description}"`);
  console.log('✓ assets: players + FAAB + picks parsed; tokens decoded; original-owner preserved; HTML stripped');

  // Token parser: current-year DP tokens are one-less (DP_02_05 = round 3, pick 6).
  const dp = mflRepo.parsePickToken('DP_02_05');
  assert(dp.kind === 'current' && dp.round === 3 && dp.pick === 6, `DP token decoded one-less, got ${JSON.stringify(dp)}`);
  console.log('✓ parsePickToken: DP_02_05 → round 3, pick 6 (one-less convention)');

  console.log('\nASSETS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
