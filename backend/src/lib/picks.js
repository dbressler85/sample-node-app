'use strict';

// Future draft picks a franchise owns, carrying BOTH the MFL trade token and a
// display label. The token matters for trades: MFL identifies a future pick as
// FP_<originalOwnerFranchiseId>_<year>_<round>, and that's what tradeProposal
// expects in WILL_GIVE_UP / WILL_RECEIVE.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('./mfl');

// Estimated dynasty value (0-100 scale) for a draft pick from its label. This is a
// model, not a market price: a round-based baseline plus a dynasty time-value discount
// for picks further out (a 1st two years away is worth less than this year's). Pick slot
// isn't known for future picks, so round is the best signal. Single source of truth so the
// roster's pick chips and the trade desk always show the same number.
const PICK_VALUE_BY_ROUND = { 1: 55, 2: 28, 3: 14, 4: 7 };
function value(label) {
  const s = String(label);
  // Known-slot picks read "2026 1.11" (round.pick); future picks read "2027 1st".
  const slot = /\b(\d+)\.(\d{1,2})\b/.exec(s);
  const rm = /(\d+)\s*(?:st|nd|rd|th)/i.exec(s);
  const round = slot ? parseInt(slot[1], 10) : rm ? parseInt(rm[1], 10) : 4;
  let base = PICK_VALUE_BY_ROUND[round] != null ? PICK_VALUE_BY_ROUND[round] : Math.max(3, 8 - round);
  const ym = /(20\d{2})/.exec(s);
  if (ym) {
    const yearsOut = parseInt(ym[1], 10) - (config.season || parseInt(ym[1], 10));
    if (yearsOut > 0) base = Math.round(base * Math.pow(0.88, Math.min(yearsOut, 4))); // ~12%/yr
  }
  return Math.max(2, base);
}

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

// [{ token, label, year, round }] for a franchise's future picks — the signed-in
// franchise by default, or any `franchiseId` (e.g. a trade partner's, to build a
// counter sweetener). Demo tokens are 'pick:LABEL' (display-only) and only the
// signed-in franchise's picks are modeled; live tokens are real MFL FP_ tokens.
async function franchisePicks(cookie, league, franchiseId = league.franchiseId) {
  const fid = String(franchiseId);
  if (config.demoMode) {
    if (fid !== String(league.franchiseId)) return []; // no per-partner inventory in demo
    return (demo.picks(league.leagueId) || []).map((label) => {
      const ym = /(\d{4})/.exec(label);
      const rm = /(\d+)\s*(?:st|nd|rd|th)/i.exec(label);
      return { token: `pick:${label}`, label, year: ym ? Number(ym[1]) : null, round: rm ? Number(rm[1]) : null };
    });
  }
  try {
    const res = await mfl.exportRequest('futureDraftPicks', { host: league.host, cookie, L: league.leagueId, FRANCHISE: fid });
    const arr = mfl.toArray(res && res.futureDraftPicks && res.futureDraftPicks.franchise);
    const fr = arr.find((f) => String(f.id) === fid) || arr[0];
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
      const owner = String(originalKnown ? orig : fid).padStart(4, '0');
      return { token: `FP_${owner}_${p.year}_${p.round}`, label: `${p.year} ${ordinal(p.round)}`, year: Number(p.year), round: Number(p.round), originalKnown };
    });
  } catch (e) {
    return [];
  }
}

// Every franchise's future picks in ONE call — MFL's futureDraftPicks returns all
// franchises, so we fetch once and index by franchise id rather than N times. Returns
// { franchiseId -> [{token,label,year,round}] }. Live only; demo returns {}.
async function franchisePicksMap(cookie, league) {
  if (config.demoMode) return {};
  try {
    const res = await mfl.exportRequest('futureDraftPicks', { host: league.host, cookie, L: league.leagueId });
    const arr = mfl.toArray(res && res.futureDraftPicks && res.futureDraftPicks.franchise);
    const out = {};
    for (const fr of arr) {
      out[String(fr.id)] = mfl.toArray(fr.futureDraftPick).map((p) => {
        const orig = p.originalPickFor || p.originalPickForFranchise || p.originalOwningFranchiseId || p.original_franchise;
        const originalKnown = orig != null && orig !== '';
        const owner = String(originalKnown ? orig : fr.id).padStart(4, '0');
        return { token: `FP_${owner}_${p.year}_${p.round}`, label: `${p.year} ${ordinal(p.round)}`, year: Number(p.year), round: Number(p.round) };
      });
    }
    return out;
  } catch (e) {
    return {};
  }
}

module.exports = { franchisePicks, franchisePicksMap, ordinal, labelForToken, value };
