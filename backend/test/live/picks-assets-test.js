'use strict';
// picksLib.assetsByFranchise — maps MFL's `assets` export into per-franchise tradable picks
// (current DP_ + future FP_), the authoritative post-trade source now wired into the pick
// inventory + trade construction. Stubs mflRepo.assets (no network).
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mflRepo = require('../../src/lib/mflRepo');
const picks = require('../../src/lib/picks');

const league = { host: 'www55.myfantasyleague.com', leagueId: '0001', franchiseId: '0007' };

(async () => {
  // Shape mirrors what mflRepo.assets returns (post-normalization): each franchise's picks carry
  // the token + parsed fields + the (HTML-stripped) description.
  mflRepo.assets = async () => [
    {
      id: '0007',
      faab: 510,
      playerIds: ['13593'],
      picks: [
        { token: 'DP_0_11', description: 'Year 2026 Draft Pick 1.12', kind: 'current', round: 1, pick: 12 },
        { token: 'FP_0002_2027_1', description: 'Year 2027 Round 1 Draft Pick from Downs With The Sickness', kind: 'future', originalOwner: '0002', year: 2027, round: 1 },
        { token: 'FP_0007_2028_2', description: 'Year 2028 Round 2 Draft Pick from Sweetness', kind: 'future', originalOwner: '0007', year: 2028, round: 2 },
      ],
    },
  ];

  const map = await picks.assetsByFranchise('ck', league);
  assert(map && map['0007'] && map['0007'].length === 3, `maps a franchise's picks, got ${map && map['0007'] && map['0007'].length}`);
  const byToken = Object.fromEntries(map['0007'].map((p) => [p.token, p]));

  // Current-year DP token: labelled from the token, kind current, this season's year, pick set.
  const dp = byToken.DP_0_11;
  assert(dp.kind === 'current' && dp.round === 1 && dp.pick === 12 && /1\.12$/.test(dp.label), `DP mapped: ${JSON.stringify(dp)}`);

  // ACQUIRED future pick: original owner (0002) differs from the holder (0007) → carries the
  // original-owner team name from the description.
  const acq = byToken.FP_0002_2027_1;
  assert(acq.kind === 'future' && acq.originalOwner === '0002' && acq.year === 2027 && acq.round === 1, `FP mapped: ${JSON.stringify(acq)}`);
  assert(acq.from === 'Downs With The Sickness', `acquired pick carries the original owner name, got "${acq.from}"`);

  // OWN future pick: original owner == holder → `from` still names the team (callers decide it's
  // not "acquired" by comparing originalOwner to the holder id).
  const own = byToken.FP_0007_2028_2;
  assert(own.originalOwner === '0007' && own.from === 'Sweetness', 'own future pick still parses its description');
  console.log('✓ assetsByFranchise maps DP/FP tokens + labels + acquired-from names');

  // Demo mode returns null so callers fall back to the composed source.
  process.env.MFL_DEMO_MODE = 'true';
  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/lib/picks')];
  const picksDemo = require('../../src/lib/picks');
  assert((await picksDemo.assetsByFranchise('ck', league)) === null, 'demo mode → null (callers fall back)');
  console.log('✓ demo mode returns null (fallback preserved)');

  console.log('\nPICKS ASSETS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
