'use strict';
// Device/backend parity self-check (docs/ARCHITECTURE_REVIEW_2026-07-device-origin.md A-6/U-6). Pins the
// ACCEPTANCE BAR of the shadow-compare (roster MEMBERSHIP + SLOT strict; ordering + status-string cosmetics
// ignored) and that the sampled recorder tallies samples/divergences onto /_metrics. Pure compare + a
// stubbed sample, so no network.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const shadowParity = require('../../src/lib/shadowParity');
const metrics = require('../../src/lib/metrics');
const leaguesService = require('../../src/services/leagues');
const mflRepo = require('../../src/lib/mflRepo');

// A raw `rosters` franchise array (as reads.rosters.parse / mflRepo.rosters returns).
const BASE = [
  { id: '0001', player: [{ id: '10', status: 'STARTER' }, { id: '20', status: 'ACTIVE' }, { id: '30', roster_status: 'INJURED_RESERVE' }] },
  { id: '0002', player: [{ id: '40', status: 'STARTER' }] },
];

(async () => {
  // --- acceptance bar: identical membership+slot → NOT diverged, regardless of order / status-key form ---
  const reordered = [
    { id: '0002', player: [{ id: '40', status: 'STARTER' }] },
    { id: '0001', player: [{ id: '30', status: 'INJURED_RESERVE' }, { id: '10', status: 'STARTER' }, { id: '20', status: 'ACTIVE' }] }, // IR via `status` here, `roster_status` in BASE
  ];
  assert(shadowParity.compareRosters(reordered, BASE).diverged === false, 'same membership+slot in a different order (and status vs roster_status) is NOT a divergence');

  // --- membership divergence: a player the device is missing ---
  const missing = JSON.parse(JSON.stringify(BASE));
  missing[0].player = missing[0].player.filter((p) => p.id !== '20');
  const rM = shadowParity.compareRosters(missing, BASE);
  assert(rM.diverged === true && rM.reasons.some((s) => /player 20 .*missing on device/.test(s)), `a missing player is a divergence, got ${JSON.stringify(rM)}`);

  // --- slot divergence: same player, different bucket (starter vs bench) ---
  const slot = JSON.parse(JSON.stringify(BASE));
  slot[0].player.find((p) => p.id === '10').status = 'ACTIVE'; // was STARTER
  const rS = shadowParity.compareRosters(slot, BASE);
  assert(rS.diverged === true && rS.reasons.some((s) => /player 10 .*slot bench!=starter/.test(s)), `a slot change is a divergence, got ${JSON.stringify(rS)}`);

  // --- extra player on device ---
  const extra = JSON.parse(JSON.stringify(BASE));
  extra[1].player.push({ id: '99', status: 'ACTIVE' });
  assert(shadowParity.compareRosters(extra, BASE).diverged === true, 'an extra player on the device is a divergence');
  console.log('✓ acceptance bar: membership + slot strict; ordering + status-key form ignored');

  // --- sampled recorder: forces the sample (rate=1), stubs the backend fetch, tallies to /_metrics ---
  metrics._reset();
  const LEAGUE = { leagueId: '1000', name: 'L', host: 'www10.myfantasyleague.com', franchiseId: '0001' };
  leaguesService.listLeagues = async () => [LEAGUE];
  mflRepo.rosters = async () => BASE;

  await shadowParity.sampleRosters('ck', { 1000: BASE }, 1); // device == backend → sample, no divergence
  let snap = metrics.snapshot().deviceParity;
  assert(snap.shadowSamples === 1 && snap.shadowDiverged === 0, `a matching sample is counted, not diverged, got ${JSON.stringify(snap)}`);

  await shadowParity.sampleRosters('ck', { 1000: missing }, 1); // device drops player 20 → divergence
  snap = metrics.snapshot().deviceParity;
  assert(snap.shadowSamples === 2 && snap.shadowDiverged === 1, `a diverging sample is flagged, got ${JSON.stringify(snap)}`);

  // rate 0 never samples (and a missing league is a no-op, never throws)
  await shadowParity.sampleRosters('ck', { 1000: BASE }, 0);
  await shadowParity.sampleRosters('ck', { 4242: BASE }, 1); // league not in listLeagues → skipped
  snap = metrics.snapshot().deviceParity;
  assert(snap.shadowSamples === 2, `rate 0 + an unknown league take no sample, got ${snap.shadowSamples}`);
  console.log('✓ sampled recorder: matching vs diverging samples tallied on /_metrics; rate 0 / unknown league = no-op');

  console.log('\nSHADOW PARITY HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
