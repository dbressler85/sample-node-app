'use strict';

// The value-lens matrix shared by every board that shows dynasty values (rankings, best-available,
// watchlist). A "lens" is one market view: 1QB vs 2QB × TE-premium off/on, at the 12-team default (99%
// of leagues). Attaching ALL four lenses to a row lets the client re-PRICE + re-SORT the board on a
// lens toggle INSTANTLY, with no round-trip — the numbers only move ~once a day.
//
// It's four lenses but really two FantasyCalc datasets: TE-premium is a multiplier we derive, not a
// separate fetch, and the QB-superflex premium is baked into the 2QB dataset. Both datasets are
// memoized in enrichment and kept warm by the background prime, so building the lens set is cheap.

const enrichmentLib = require('./enrichment');
const leagueFormat = require('./leagueformat');

const RANK_LENSES = [['1qb', false], ['1qb', true], ['sf', false], ['sf', true]];
const lensId = (fmt, tep) => `${fmt === 'sf' ? 'sf' : '1qb'}${tep ? '_tep' : ''}`;

// The four enrichment snapshots keyed by lens id (`1qb` / `1qb_tep` / `sf` / `sf_tep`). Fetched in
// parallel; each resolves to a memoized/warm snapshot so this is near-free once the prime has run.
async function buildLensSnaps(cookie) {
  const entries = await Promise.all(
    RANK_LENSES.map(async ([fmt, tep]) => [lensId(fmt, tep), await enrichmentLib.snapshot(leagueFormat.lensFormat(fmt, tep), cookie)])
  );
  return Object.fromEntries(entries);
}

// Attach `lensValues` — { <lensId>: { v: dynasty, w: win-now } } — to each row in place, so the client
// can re-price the whole board locally on a lens toggle. Rows must carry an `id`. Returns `rows`.
function attachLensValues(rows, lensSnaps) {
  const lensKeys = Object.keys(lensSnaps);
  for (const row of rows) {
    row.lensValues = {};
    for (const key of lensKeys) {
      const s = lensSnaps[key];
      row.lensValues[key] = { v: s.value(row.id), w: s.winNow ? s.winNow(row.id) : null };
    }
  }
  return rows;
}

module.exports = { RANK_LENSES, lensId, buildLensSnaps, attachLensValues };
