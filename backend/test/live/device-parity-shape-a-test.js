'use strict';
// Device/backend PARITY for the "device ASSEMBLES" (Shape A) surfaces — leagueTeams (Rosters), standings,
// and transactions (docs/ARCHITECTURE_REVIEW_2026-07-device-origin.md M-2). Unlike the "backend
// AGGREGATES" (Shape B) surfaces — which re-parse device raw with the SAME code and were already
// parity-tested — these build the FINAL payload two independent ways: on-device via mflRead.assemble* and
// on the backend via services/league.js. This harness drives BOTH from the SAME stubbed MFL source and
// asserts byte-identical output, so the two can't silently diverge (the failure mode M-2 documents: dropped
// top-level fields, and an IR/taxi player mis-tagged because the device read only `status`, not
// `status || roster_status`). A real IR player carried under `roster_status` (not `status`) is included to
// pin that fix.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// Stub shared service deps BEFORE requiring the service under test.
const leaguesService = require('../../src/services/leagues');
const playersLib = require('../../src/lib/players');
const enrichmentLib = require('../../src/lib/enrichment');
const leagueFormat = require('../../src/lib/leagueformat');
const mflRepo = require('../../src/lib/mflRepo');
const mfl = require('../../src/lib/mfl');
const mflRead = require('../../src/lib/mflRead');

const LEAGUE = { leagueId: '1000', name: 'League A', host: 'www49.myfantasyleague.com', franchiseId: '0001' };
const NAMES = new Map([['0001', 'Team One'], ['0002', 'Team Two']]);

// Rosters: franchise 0001 has an IR player carried under `roster_status` (NOT `status`) + a taxi player —
// the exact shape that mis-tagged as active when the device read only `status` (M-2).
const RAW_FRANCHISES = [
  { id: '0001', player: [{ id: '10', status: 'STARTER' }, { id: '20', roster_status: 'INJURED_RESERVE' }, { id: '30', status: 'TAXI_SQUAD' }] },
  { id: '0002', player: [{ id: '40', status: 'STARTER' }, { id: '50', status: 'ACTIVE' }] },
];
const RAW_STANDINGS = [
  { id: '0001', h2hw: '5', h2hl: '2', h2ht: '0', pf: '1234.5', pa: '1100.2', strk: 'W3', all_play_pct: '0.7', h2hpct: '0.714', pp: '1300.1' },
  { id: '0002', h2hw: '3', h2hl: '4', h2ht: '0', pf: '1000.0', pa: '1050.0' },
];
const RAW_TXNS = [
  { type: 'FREE_AGENT', timestamp: '1700000000', franchise: '0001', transaction: '10|20' },
  { type: 'TRADE', timestamp: '1700000100', franchise: '0001', transaction: '30|40|0002' },
];

leaguesService.listLeagues = async () => [LEAGUE];
leaguesService.franchiseNames = async () => NAMES;
playersLib.load = async () => ({});
playersLib.resolve = (_byId, id) => ({ name: `Player ${id}`, position: 'RB', team: 'AAA' });
enrichmentLib.snapshot = async () => ({ value: (id) => Number(id) * 10 });
leagueFormat.format = async () => ({ numQbs: 2, ppr: 1, tePpr: 1, pprDetected: true });
mfl.exportRequest = async () => ({}); // playoffSpotsFor → null gracefully (both paths agree)
mflRepo.rosters = async () => RAW_FRANCHISES;
mflRepo.standings = async () => RAW_STANDINGS;
mflRepo.transactions = async () => RAW_TXNS;

const league = require('../../src/services/league');
const CK = 'ck';

// The device path: fetch raw straight from MFL (here, the same stubbed source), then assemble on-device with
// the backend-supplied dictionaries (player lookup + franchise directory), exactly as mobile/src/mflDevice.js
// does — but calling the backend service functions directly for those dictionaries so the test drives one
// process. Both getPlayerLookup and getFranchiseDirectory are the real backend endpoints the device calls.
(async () => {
  // --- 1. leagueTeams / Rosters ---
  {
    const backend = await league.getTeams(CK, '1000');
    const dir = await league.getFranchiseDirectory(CK, '1000');
    const franchises = mflRead.reads.rosters.parse({ rosters: { franchise: RAW_FRANCHISES } }).map(mflRead.shapeRoster);
    const ids = [...new Set(franchises.flatMap((f) => f.players.map((p) => p.id)))];
    const dict = await league.getPlayerLookup(CK, ids, '1000');
    const device = mflRead.assembleTeams(franchises, dict.players, dir);
    assert(JSON.stringify(device) === JSON.stringify(backend), `leagueTeams device != backend\n  device : ${JSON.stringify(device)}\n  backend: ${JSON.stringify(backend)}`);
    // Pin the specific M-2 fixes: the roster_status IR player is 'ir' on BOTH paths, and the top-level
    // fields the device used to drop are present.
    const mine = backend.teams.find((t) => t.mine);
    const ir = mine.players.find((p) => p.id === '20');
    assert(ir && ir.slot === 'ir', `roster_status IR player mis-slotted (got ${ir && ir.slot})`);
    assert(device.leagueId === '1000' && device.name === 'League A' && device.format, 'device teams carry leagueId/name/format');
    console.log('✓ leagueTeams: device === backend (incl. roster_status IR slot + top-level leagueId/name/format)');
  }

  // --- 2. standings ---
  {
    const backend = await league.getStandings(CK, '1000');
    const dir = await league.getFranchiseDirectory(CK, '1000');
    const rows = mflRead.reads.standings.parse({ leagueStandings: { franchise: RAW_STANDINGS } });
    const device = mflRead.assembleStandings(rows, dir);
    assert(JSON.stringify(device) === JSON.stringify(backend), `standings device != backend\n  device : ${JSON.stringify(device)}\n  backend: ${JSON.stringify(backend)}`);
    assert(device.leagueId === '1000' && device.name === 'League A', 'device standings carry leagueId/name');
    console.log('✓ standings: device === backend (incl. top-level leagueId/name)');
  }

  // --- 3. transactions ---
  {
    const backend = await league.getTransactions(CK, '1000');
    const dir = await league.getFranchiseDirectory(CK, '1000');
    const parsed = mflRead.parseTransactions(RAW_TXNS);
    const ids = [...new Set(parsed.flatMap((t) => [...(t.addedIds || []), ...(t.droppedIds || [])]))];
    const dict = await league.getPlayerLookup(CK, ids, '1000');
    const device = mflRead.assembleTransactions(RAW_TXNS, dict.players, dir);
    assert(JSON.stringify(device) === JSON.stringify(backend), `transactions device != backend\n  device : ${JSON.stringify(device)}\n  backend: ${JSON.stringify(backend)}`);
    assert(device.leagueId === '1000' && device.name === 'League A', 'device transactions carry leagueId/name');
    console.log('✓ transactions: device === backend (incl. top-level leagueId/name)');
  }

  console.log('\nDEVICE PARITY (SHAPE A) HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
