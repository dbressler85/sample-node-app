'use strict';

// Average Draft Position (ADP) — the market-consensus draft order, from MFL's global
// `adp` export (across all its leagues; no league/cookie needed). Used to order the
// draft board so it reflects where players actually go, rather than a personalized or
// dynasty-value ranking. Objective and owner-independent by design.
//
// Best-effort: MFL blocks its own API docs from us, so the response shape is tolerated
// defensively (id + average-pick under a few likely field names). A miss just means a
// player has no ADP and falls to the value-ranked tail — never an error. Memoized on a
// long TTL (ADP moves slowly), keyed globally since the export isn't per-account.

const config = require('../config');
const mfl = require('./mfl');
const demo = require('../demo/fixtures');
const { createMemo } = require('./memo');

const memo = createMemo({ ttlMs: 6 * 60 * 60 * 1000 }); // 6h — ADP barely moves intraday

function parseRows(res) {
  const rows = mfl.toArray(res && res.adp && res.adp.player);
  const m = new Map();
  for (const r of rows) {
    if (!r) continue;
    const id = r.id || r.playerId || r.player_id;
    const pick = parseFloat(r.averagePick != null ? r.averagePick : r.adp != null ? r.adp : r.avgPick);
    if (id != null && Number.isFinite(pick)) m.set(String(id), Math.round(pick * 10) / 10);
  }
  return m;
}

// Map of playerId -> average draft pick (lower = drafted earlier). Empty map on any
// failure so callers can fall back to their own ordering.
async function adpMap(cookie) {
  if (config.demoMode) {
    const fx = demo.adp() || {};
    return new Map(Object.entries(fx).map(([id, v]) => [String(id), v]));
  }
  return memo.get('adp', async () => {
    try {
      // PERIOD=RECENT keeps it current; IS_KEEPER selects dynasty-relevant drafts (keeper +
      // rookie by default) rather than MFL's redraft-inclusive mix. Same response shape.
      const res = await mfl.exportRequest('adp', { cookie, PERIOD: 'RECENT', IS_KEEPER: config.mflAdpIsKeeper });
      return parseRows(res);
    } catch (e) {
      return new Map();
    }
  });
}

module.exports = { adpMap, parseRows };
