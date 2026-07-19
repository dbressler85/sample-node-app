'use strict';

// Scoring engine — turns projected raw stats into projected fantasy points for a
// SPECIFIC league's scoring settings. This is what makes the optimizer correct
// across formats: the same stat line is worth different points in PPR vs standard,
// under a TE premium, or with 6-pt passing TDs.
//
// A player's optimal start/sit can flip purely on format, so projections must be
// computed per league, never shared as one flat number.

// Points per unit for each stat category. Overridden per league.
const DEFAULT_SCORING = {
  passYdsPer: 0.04, // 1 pt / 25 yds
  passTd: 4, // 4 or 6 are the common values
  passInt: -2,
  rushYdsPer: 0.1, // 1 pt / 10 yds
  rushTd: 6,
  recYdsPer: 0.1,
  recTd: 6,
  ppr: 0, // points per reception (0, 0.5, 1)
  tePremium: 0, // EXTRA points per reception for TEs, on top of ppr
  fumbleLost: -2,
  // Kicker (position 'PK'). FGs split by distance; the raw stat line carries
  // fgAny (made under 50) and fg50 (made 50+) separately so the two aren't
  // double-counted.
  xpMade: 1,
  fgAny: 3,
  fg50: 5,
  fgMiss: 0, // most leagues don't penalize; override to -1 where they do
  // Team defense / special teams (position 'DEF').
  sack: 1,
  defInt: 2,
  fumRec: 2,
  defTd: 6,
  safety: 2,
  // Points-allowed tiers: [maxPointsAllowed, fantasyPoints], first match wins.
  // The classic ESPN/MFL default scale; override per league if needed.
  pointsAllowedTiers: [
    [0, 10],
    [6, 7],
    [13, 4],
    [20, 1],
    [27, 0],
    [34, -1],
    [Infinity, -4],
  ],
};

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Fantasy points for a defense's (expected) points allowed, using the league's
// tier table. A fractional expectation (e.g. 18.5) buckets by its rounded value.
function pointsAllowedScore(pointsAllowed, tiers) {
  const pa = Math.round(pointsAllowed);
  for (const [max, pts] of tiers) {
    if (pa <= max) return pts;
  }
  return 0;
}

// Projected fantasy points for one stat line under `scoring`.
// `position` matters because the TE premium only applies to tight ends, and
// kicker/defense lines score on entirely different categories.
function projectPoints(stat, position, scoring) {
  const s = { ...DEFAULT_SCORING, ...(scoring || {}) };
  const st = stat || {};
  const perRec = s.ppr + (position === 'TE' ? s.tePremium : 0);

  const offense =
    (st.passYds || 0) * s.passYdsPer +
    (st.passTd || 0) * s.passTd +
    (st.passInt || 0) * s.passInt +
    (st.rushYds || 0) * s.rushYdsPer +
    (st.rushTd || 0) * s.rushTd +
    (st.recYds || 0) * s.recYdsPer +
    (st.recTd || 0) * s.recTd +
    (st.rec || 0) * perRec +
    (st.fumblesLost || 0) * s.fumbleLost;

  const kicker =
    (st.xp || 0) * s.xpMade +
    (st.fgAny || 0) * s.fgAny +
    (st.fg50 || 0) * s.fg50 +
    (st.fgMiss || 0) * s.fgMiss;

  const defense =
    (st.sack || 0) * s.sack +
    (st.defInt || 0) * s.defInt +
    (st.fumRec || 0) * s.fumRec +
    (st.defTd || 0) * s.defTd +
    (st.safety || 0) * s.safety +
    (st.pointsAllowed != null ? pointsAllowedScore(st.pointsAllowed, s.pointsAllowedTiers) : 0);

  return round1(offense + kicker + defense);
}

// MODEL ESTIMATE (not a real distribution): rough weekly volatility by position,
// used to widen a single median projection into a floor/ceiling band. QBs are
// steady; TEs swing. Consumers surface floor/ceiling as an estimate, not a
// sourced projection range.
const POSITION_VOLATILITY = { QB: 0.22, RB: 0.34, WR: 0.4, TE: 0.46, PK: 0.3, DEF: 0.45 };

// Floor / median / ceiling band around a median projection. `estimated` flags
// that floor/ceiling are model-derived (the median may be a real MFL projection,
// but the spread is the volatility model above).
function band(median, position) {
  const v = POSITION_VOLATILITY[position] != null ? POSITION_VOLATILITY[position] : 0.35;
  return {
    floor: round1(median * (1 - v)),
    median: round1(median),
    ceiling: round1(median * (1 + v)),
    estimated: true,
  };
}

// Short human-readable format label, e.g. "PPR · TE+0.5 · 6pt PaTD".
function describe(scoring) {
  const s = { ...DEFAULT_SCORING, ...(scoring || {}) };
  const parts = [];
  parts.push(s.ppr >= 1 ? 'PPR' : s.ppr > 0 ? `${s.ppr} PPR` : 'Standard');
  if (s.tePremium > 0) parts.push(`TE+${s.tePremium}`);
  parts.push(`${s.passTd}pt PaTD`);
  return parts.join(' · ');
}

module.exports = { DEFAULT_SCORING, projectPoints, describe, band, round1 };
