'use strict';
// Device-origin (docs/DEVICE_ORIGIN_MFL.md) for the cross-league pick inventory. The demo pick test
// exercises the FALLBACK path (demo has no `assets`); this drives the LIVE assets path and proves that
// when the app supplies each league's assets/futureDraftPicks/draftResults it fetched on-device, the
// SAME inventory is assembled with ZERO backend reads of those three types.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const mfl = require('../../src/lib/mfl');
const leaguesService = require('../../src/services/leagues');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

leaguesService.orderedLeagues = async () => [
  { leagueId: 'L1', name: 'Test League', host: 'www49.myfantasyleague.com', franchiseId: '0001' },
];

// One franchise's assets: two future picks — my own 2027 1st, and a 2027 2nd acquired from Team 2.
const ASSETS_FRANCHISE = [{
  id: '0001',
  futureYearDraftPicks: { draftPick: [
    { pick: 'FP_0001_2027_1', description: '' },
    { pick: 'FP_0002_2027_2', description: 'Acquired in a trade with Team 2' },
  ] },
}];
const FUTURE = [{ id: '0001', futureDraftPick: [{ year: '2027', round: '1' }] }]; // fallback source (unused when assets present)
const DRAFT = [{ unit: 'LEAGUE', draftPick: [] }];

const reads = { assets: 0, futureDraftPicks: 0, draftResults: 0 };
mfl.exportRequest = async (type) => {
  if (type in reads) reads[type] += 1;
  switch (type) {
    case 'assets': return { assets: { franchise: ASSETS_FRANCHISE } };
    case 'futureDraftPicks': return { futureDraftPicks: { franchise: FUTURE } };
    case 'draftResults': return { draftResults: { draftUnit: DRAFT } };
    case 'league': return { league: { franchises: { franchise: [{ id: '0001', name: 'Me' }, { id: '0002', name: 'Team 2' }] } } };
    case 'players': return { players: { player: [] } };
    default: return {};
  }
};
global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => [], text: async () => '{}' });

const draft = require('../../src/services/draft');

(async () => {
  // Backend path: reads assets (authoritative) and value/label/group them.
  const get = await draft.getPickInventory('ck', 'tk');
  assert(get.summary.total >= 2 && get.picks.length >= 2, `backend inventory has the picks, got ${JSON.stringify(get.summary)}`);
  assert(get.picks.every((p) => p.token && p.label && typeof p.value === 'number'), 'each pick carries a token, label, and value');
  assert(get.picks.some((p) => p.acquiredFrom), 'the acquired pick is attributed');
  console.log(`✓ backend pick inventory from the assets export (${get.summary.total} picks)`);

  // Device path: the app supplies all three reads → same inventory, zero backend reads of those types.
  const before = { ...reads };
  const deviceReads = { L1: { assets: ASSETS_FRANCHISE, futureDraftPicks: FUTURE, draftResults: DRAFT } };
  const dev = await draft.getPickInventory('ck', 'tk', { deviceReads });
  assert(
    reads.assets === before.assets && reads.futureDraftPicks === before.futureDraftPicks && reads.draftResults === before.draftResults,
    `device path issues NO backend assets/futureDraftPicks/draftResults reads, got ${JSON.stringify({ a: reads.assets - before.assets, f: reads.futureDraftPicks - before.futureDraftPicks, d: reads.draftResults - before.draftResults })}`
  );
  assert(JSON.stringify(dev.picks.map((p) => p.token)) === JSON.stringify(get.picks.map((p) => p.token)), 'device inventory has the same pick tokens as the backend');
  assert(dev.summary.total === get.summary.total && dev.summary.totalValue === get.summary.totalValue, `device summary matches the backend, got ${JSON.stringify(dev.summary)} vs ${JSON.stringify(get.summary)}`);
  console.log(`✓ device-origin pick inventory: app-supplied reads → identical inventory, zero backend assets/futureDraftPicks/draftResults reads`);

  console.log('\nPICK INVENTORY DEVICE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
