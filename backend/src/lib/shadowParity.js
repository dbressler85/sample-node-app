'use strict';

// Sampled device/backend PARITY self-check (docs/ARCHITECTURE_REVIEW_2026-07-device-origin.md A-6 / U-6).
// On a small SAMPLE of device-origin rosters reads, the backend ALSO fetches the roster itself and compares
// what the DEVICE supplied against what the BACKEND would have fetched — so a silent divergence (the device
// serving different or stale data than the backend, at a healthy device%) becomes OBSERVABLE on /_metrics
// instead of shipping invisibly. Fire-and-forget: it never affects the response, and it's sampled so the
// extra backend read is amortized (device-origin's whole point is to NOT read on the backend, so this check
// must be rare).
//
// The ACCEPTANCE BAR is the product-owner's (U-6): STRICT on what the manager actually acts on — roster
// MEMBERSHIP (which players are on which franchise) and each player's SLOT (active / bench / ir / taxi) —
// and it IGNORES ordering and cosmetic fields. So it flags "the device thinks I roster a different player,
// or in a different slot, than the backend," not "the two arrays are in a different order."

const mflRead = require('./mflRead');
const metrics = require('./metrics');

// franchiseId (4-pad) -> Map(playerId -> slot), from a raw `rosters` franchise array (device or backend).
// Uses the shared core's own primitives + the exact status→slot rule so the compare mirrors what the
// screens render (status OR roster_status, matching shapeRoster after M-2).
function indexFranchises(franchises) {
  const out = new Map();
  for (const f of mflRead.toArray(franchises)) {
    const fid = mflRead.fid(f && f.id);
    if (!fid) continue;
    const players = new Map();
    for (const p of mflRead.toArray(f && f.player)) {
      const id = mflRead.text(p && p.id);
      if (!id) continue;
      const status = mflRead.text(p && p.status) || mflRead.text(p && p.roster_status);
      players.set(id, mflRead.exposureBucket(status));
    }
    out.set(fid, players);
  }
  return out;
}

// Compare device-supplied vs backend-fetched raw rosters for ONE league. Returns { diverged, reasons: [...] }
// (reasons capped at 5). Pure — no I/O — so the acceptance bar is unit-testable.
function compareRosters(deviceFranchises, backendFranchises) {
  const dev = indexFranchises(deviceFranchises);
  const bak = indexFranchises(backendFranchises);
  const reasons = [];
  const add = (r) => { if (reasons.length < 5) reasons.push(r); };

  for (const fid of bak.keys()) if (!dev.has(fid)) add(`franchise ${fid} missing on device`);
  for (const fid of dev.keys()) if (!bak.has(fid)) add(`franchise ${fid} extra on device`);

  for (const [fid, bakPlayers] of bak) {
    const devPlayers = dev.get(fid);
    if (!devPlayers) continue;
    for (const [pid, bakSlot] of bakPlayers) {
      if (!devPlayers.has(pid)) add(`player ${pid} (fr ${fid}) missing on device`);
      else if (devPlayers.get(pid) !== bakSlot) add(`player ${pid} (fr ${fid}) slot ${devPlayers.get(pid)}!=${bakSlot}`);
    }
    for (const pid of devPlayers.keys()) if (!bakPlayers.has(pid)) add(`player ${pid} (fr ${fid}) extra on device`);
  }
  return { diverged: reasons.length > 0, reasons };
}

// Sampled, fire-and-forget: on a `rate` fraction of calls, pick ONE league from the device rosters map,
// fetch the backend's own rosters for it, and compare. Records the sample (and any divergence) to /_metrics.
// Never throws and never awaits into the response path — a self-check must never affect the user's request.
// A rare false positive is possible (a roster changed in the seconds between the device fetch and this one);
// it's an observability signal, not a gate. Lazy-requires services to avoid a load cycle.
async function sampleRosters(cookie, deviceRosters, rate) {
  try {
    const r = rate != null ? rate : 0.02;
    if (!deviceRosters || r <= 0 || Math.random() >= r) return;
    const ids = Object.keys(deviceRosters);
    if (!ids.length) return;
    const leagueId = ids[Math.floor(Math.random() * ids.length)]; // one league, to bound the extra read
    const leaguesService = require('../services/leagues');
    const mflRepo = require('./mflRepo');
    const leagues = await leaguesService.listLeagues(cookie);
    const league = (leagues || []).find((l) => String(l.leagueId) === String(leagueId));
    if (!league) return;
    const backendFranchises = await mflRepo.rosters(league, cookie);
    const { diverged, reasons } = compareRosters(deviceRosters[leagueId], backendFranchises);
    metrics.recordParity(diverged);
    if (diverged) console.warn(`[shadow-parity] league=${leagueId} device!=backend: ${reasons.join(' | ')}`);
  } catch (e) {
    /* best-effort self-check — never affects the request */
  }
}

module.exports = { compareRosters, indexFranchises, sampleRosters };
