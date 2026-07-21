'use strict';

// Future draft picks a franchise owns, carrying BOTH the MFL trade token and a
// display label. The token matters for trades: MFL identifies a future pick as
// FP_<originalOwnerFranchiseId>_<year>_<round>, and that's what tradeProposal
// expects in WILL_GIVE_UP / WILL_RECEIVE.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('./mfl');

function ordinal(round) {
  const n = parseInt(round, 10);
  if (!Number.isFinite(n)) return String(round);
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

// A readable label for an MFL draft-pick token:
//  • FP_<orig>_<year>_<round>  → "2027 1st"   (future pick — round only)
//  • DP_<round>_<pick>         → "2026 1.11"  (upcoming draft — exact slot)
// MFL's DP tokens are ZERO-based on BOTH round and pick, so DP_0_10 is round 1,
// pick 11 ("1.11") and DP_2_2 is round 3, pick 3 ("3.03"). Anything else is
// returned verbatim.
function labelForToken(token) {
  const t = String(token);
  const fp = /^FP_\d+_(\d{4})_(\d+)/.exec(t);
  if (fp) return `${fp[1]} ${ordinal(fp[2])}`;
  const dp = /^DP_(\d+)_(\d+)$/.exec(t);
  if (dp) {
    const round = parseInt(dp[1], 10) + 1;
    const pick = parseInt(dp[2], 10) + 1;
    return `${config.season} ${round}.${String(pick).padStart(2, '0')}`;
  }
  return t;
}

// [{ token, label }] for a franchise's future picks. Demo tokens are 'pick:LABEL'
// (display-only); live tokens are real MFL FP_ tokens usable in a trade.
async function franchisePicks(cookie, league) {
  if (config.demoMode) {
    return (demo.picks(league.leagueId) || []).map((label) => ({ token: `pick:${label}`, label }));
  }
  try {
    const res = await mfl.exportRequest('futureDraftPicks', { host: league.host, cookie, L: league.leagueId, FRANCHISE: league.franchiseId });
    const arr = mfl.toArray(res && res.futureDraftPicks && res.futureDraftPicks.franchise);
    const fr = arr.find((f) => String(f.id) === league.franchiseId) || arr[0];
    if (!fr) return [];
    return mfl.toArray(fr.futureDraftPick).map((p) => {
      // MFL names the original owner `originalPickFor` (older aliases kept as a
      // fallback). When it's absent the pick is the franchise's own, so the
      // listing franchise is the correct original owner. originalKnown records
      // which case we're in, so a mis-derived token can't pass silently.
      const orig = p.originalPickFor || p.originalPickForFranchise || p.originalOwningFranchiseId || p.original_franchise;
      const originalKnown = orig != null && orig !== '';
      // MFL franchise ids are 4-digit zero-padded ("0005"). tradeProposal 500s on a
      // future-pick token whose original-owner id is unpadded, and some originalPickFor
      // values come back short (e.g. "5"), so pad it back to MFL's canonical width.
      const owner = String(originalKnown ? orig : league.franchiseId).padStart(4, '0');
      return { token: `FP_${owner}_${p.year}_${p.round}`, label: `${p.year} ${ordinal(p.round)}`, originalKnown };
    });
  } catch (e) {
    return [];
  }
}

module.exports = { franchisePicks, ordinal, labelForToken };
