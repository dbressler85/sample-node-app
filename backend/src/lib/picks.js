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

// "2027 1st" for an FP_ token (or the raw string if it isn't one).
function labelForToken(token) {
  const m = /^FP_\d+_(\d{4})_(\d+)/.exec(String(token));
  return m ? `${m[1]} ${ordinal(m[2])}` : String(token);
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
      const owner = originalKnown ? String(orig) : league.franchiseId;
      return { token: `FP_${owner}_${p.year}_${p.round}`, label: `${p.year} ${ordinal(p.round)}`, originalKnown };
    });
  } catch (e) {
    return [];
  }
}

module.exports = { franchisePicks, ordinal, labelForToken };
