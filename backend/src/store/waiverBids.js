'use strict';

// Snapshot of our MFL-queued blind bids, so a LOSING bid — which MFL never writes to the transaction
// log — can still be surfaced as an "outbid" result.
//
// The source is MFL's `pendingWaivers` (our currently-queued bids), so it covers bids placed on the
// MFL SITE too, not just through the app. On each waiver view we record the current bids here. When a
// bid later disappears from MFL's pending set, the run processed it: if the player is in our recent
// WINS (transactions log) it won and we drop it silently (the win already shows via transactions);
// otherwise we were outbid, and we keep it as a 'lost' result for a few weeks. Durable via persist.
//
// Clock-free: the caller passes `now` (ms) so the store stays deterministic under test.

const persist = require('./persist');

const db = () => persist.ns('waiverBids'); // token -> { leagueId -> { pending: {key->bid}, resolved: [row] } }

const LOST_TTL_MS = 21 * 24 * 60 * 60 * 1000; // keep an outbid result visible ~3 weeks, then prune

function bucket(token, leagueId) {
  const d = db();
  if (!d[token]) d[token] = {};
  if (!d[token][leagueId]) d[token][leagueId] = { pending: {}, resolved: [] };
  return d[token][leagueId];
}

const keyOf = (p) => `${p.round == null ? '' : p.round}:${p.addId}`;

// Reconcile the franchise's current MFL-queued bids against the last snapshot.
//   currentPicks : [{ round, system, addId, dropId, bid }] from pendingWaivers (site + app bids)
//   wonAddIds    : Set of add ids won recently (from the transactions log)
//   now          : ms timestamp
// Moves any bid that's no longer queued (the run took it) to resolved — 'lost' unless it's a win —
// records the current bids, prunes stale history, and returns { lost, clearedAddIds }.
function sync(token, leagueId, currentPicks, wonAddIds, now) {
  const b = bucket(token, leagueId);
  const currentKeys = new Set(currentPicks.map(keyOf));
  const clearedAddIds = [];

  // 1) A previously-pending bid that's gone from MFL's set → the run processed it.
  for (const [k, bid] of Object.entries(b.pending)) {
    if (currentKeys.has(k)) continue; // still queued
    clearedAddIds.push(String(bid.addId));
    if (!wonAddIds.has(String(bid.addId))) {
      b.resolved.push({ addId: String(bid.addId), dropId: bid.dropId || null, bid: bid.bid, round: bid.round, system: bid.system, result: 'lost', at: now });
    }
    delete b.pending[k];
  }

  // 2) Record / refresh the current bids (keep the earliest at, so age reflects when first seen).
  for (const p of currentPicks) {
    const k = keyOf(p);
    const prior = b.pending[k];
    b.pending[k] = {
      round: p.round,
      system: p.system,
      addId: String(p.addId),
      dropId: p.dropId ? String(p.dropId) : null,
      bid: p.bid,
      at: (prior && prior.at) || now,
    };
  }

  // 3) Prune stale lost history.
  b.resolved = b.resolved.filter((r) => now - (r.at || 0) <= LOST_TTL_MS);
  persist.touch();

  return {
    lost: b.resolved.filter((r) => r.result === 'lost').map((r) => ({ ...r })),
    clearedAddIds,
  };
}

module.exports = { sync };
