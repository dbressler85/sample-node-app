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
};

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Projected fantasy points for one stat line under `scoring`.
// `position` matters because the TE premium only applies to tight ends.
function projectPoints(stat, position, scoring) {
  const s = { ...DEFAULT_SCORING, ...(scoring || {}) };
  const st = stat || {};
  const perRec = s.ppr + (position === 'TE' ? s.tePremium : 0);

  const points =
    (st.passYds || 0) * s.passYdsPer +
    (st.passTd || 0) * s.passTd +
    (st.passInt || 0) * s.passInt +
    (st.rushYds || 0) * s.rushYdsPer +
    (st.rushTd || 0) * s.rushTd +
    (st.recYds || 0) * s.recYdsPer +
    (st.recTd || 0) * s.recTd +
    (st.rec || 0) * perRec +
    (st.fumblesLost || 0) * s.fumbleLost;

  return round1(points);
}

// Rough weekly volatility by position — how boom/bust the position is. Used to
// turn a median projection into a floor/ceiling band. QBs are steady; TEs swing.
const POSITION_VOLATILITY = { QB: 0.22, RB: 0.34, WR: 0.4, TE: 0.46, PK: 0.3, DEF: 0.45 };

// Floor / median / ceiling band around a median projection.
function band(median, position) {
  const v = POSITION_VOLATILITY[position] != null ? POSITION_VOLATILITY[position] : 0.35;
  return {
    floor: round1(median * (1 - v)),
    median: round1(median),
    ceiling: round1(median * (1 + v)),
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
