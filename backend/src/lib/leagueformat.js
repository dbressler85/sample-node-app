'use strict';

// League format detection: starting requirements + the two dimensions that most
// change dynasty value — superflex (numQbs) and PPR. Used to fetch format-aware
// FantasyCalc values, and shared by the lineup service so slot parsing lives once.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('./mfl');
const playersLib = require('./players');

// A readable name for a slot given its eligible positions. A multi-position slot
// isn't just a generic "FLEX": a QB-eligible flex is a SUPERFLEX (drives value),
// RB/WR/TE is FLEX, and narrower combos get an explicit label.
function slotName(eligible) {
  if (eligible.length <= 1) return eligible[0] || 'FLEX';
  const set = new Set(eligible);
  if (set.has('QB')) return 'SUPERFLEX';
  if (set.has('RB') && set.has('WR') && set.has('TE')) return 'FLEX';
  if (set.has('RB') && set.has('WR') && set.size === 2) return 'W/R';
  if (set.has('WR') && set.has('TE') && set.size === 2) return 'W/T';
  return eligible.join('/');
}

// Normalized starting-lineup requirements: [{ name, eligible[], count }].
async function requirements(cookie, league) {
  if (config.demoMode) return demo.lineupRequirements(league.leagueId) || [];
  const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
  const positions = mfl.toArray(res && res.league && res.league.starters && res.league.starters.position);
  return positions.map((p) => {
    const eligible = String(p.name || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => playersLib.normalizePosition(s));
    // MFL limits can be a range ("1-3"); we take the max as the slot count and
    // log it so a min-max lineup can't quietly miscount starters.
    const rawLimit = String(p.limit || '1');
    if (rawLimit.includes('-')) console.log(`[leagueformat] league=${league.leagueId} range slot limit "${rawLimit}" for "${p.name}" — using max`);
    const max = parseInt(rawLimit.split('-').pop(), 10) || 1;
    return { name: slotName(eligible), eligible, count: max };
  });
}

// How many QBs a lineup can start (superflex/2QB -> 2, otherwise 1). Counts every
// slot that can hold a QB (a dedicated QB slot, plus SUPERFLEX/OP flex slots).
function numQbs(reqs) {
  let qbSlots = 0;
  for (const r of reqs || []) {
    if ((r.eligible || []).includes('QB')) qbSlots += Number(r.count) || 0;
  }
  return qbSlots >= 2 ? 2 : 1;
}

// --- live scoring-rule parsing (PPR detection) ------------------------------
// MFL's `rules` export returns per-position scoring rules whose points are given
// as formulas over stat event codes. A reception is the event `CC`, so a PPR
// rule reads like "1*CC" (full), ".5*CC" (half) or is absent (standard). We read
// the per-reception coefficient for the skill positions — that, with superflex,
// is what changes FantasyCalc dynasty value. League rules change rarely, so we
// cache per league (MFL's own guidance is to cache rules/scoring).
const RECEPTION_EVENT = 'CC'; // MFL abbreviation for a reception
const rulesCache = new Map(); // leagueId -> { at, data }
const RULES_TTL_MS = 6 * 60 * 60 * 1000;

// Per-reception points from one rule's points formula ("<coef>*CC" / "CC*<coef>").
function receptionPoints(rule) {
  const formula = String((rule && (rule.points != null ? rule.points : rule)) || '');
  let m = formula.match(new RegExp(`(\\d*\\.?\\d+)\\s*\\*\\s*${RECEPTION_EVENT}\\b`));
  if (!m) m = formula.match(new RegExp(`\\b${RECEPTION_EVENT}\\s*\\*\\s*(\\d*\\.?\\d+)`));
  return m ? Number(m[1]) || 0 : 0;
}

// Detect PPR (and any TE premium) from the live scoring rules. Returns
// { detected, ppr, tePpr }. On any miss/failure `detected` is false so callers
// keep the safe full-PPR default rather than trusting a bad parse.
async function scoringRules(cookie, league) {
  const cached = rulesCache.get(league.leagueId);
  if (cached && Date.now() - cached.at < RULES_TTL_MS) return cached.data;

  let data = { detected: false };
  try {
    const res = await mfl.exportRequest('rules', { host: league.host, cookie, L: league.leagueId });
    const groups = mfl.toArray(res && res.rules && res.rules.positionRules);
    const pprByPos = {}; // position -> per-reception points (max across that group's rules)
    for (const g of groups) {
      const positions = String(g.positions || '').split('|').map((s) => s.trim()).filter(Boolean);
      let recPts = 0;
      for (const r of mfl.toArray(g.rule)) recPts = Math.max(recPts, receptionPoints(r));
      for (const pos of positions) pprByPos[pos] = Math.max(pprByPos[pos] || 0, recPts);
    }
    const base = pprByPos.RB != null ? pprByPos.RB : pprByPos.WR != null ? pprByPos.WR : pprByPos.TE;
    if (base != null) {
      data = { detected: true, ppr: base, tePpr: pprByPos.TE != null ? pprByPos.TE : base };
      console.log(`[scoringRules] league=${league.leagueId} ppr=${data.ppr} tePpr=${data.tePpr}`);
    }
  } catch (e) {
    console.log(`[scoringRules] league=${league.leagueId} failed: ${e.message}`);
  }
  rulesCache.set(league.leagueId, { at: Date.now(), data });
  return data;
}

// { numQbs, ppr, tePpr, pprDetected } for a league. Superflex (numQbs) is always
// derived from the lineup slots. PPR comes from demo scoring in demo and from the
// live scoring rules in live — falling back to full PPR (the dynasty norm) only
// when the rules can't be parsed, with `pprDetected` telling callers which it is.
async function format(cookie, league) {
  const reqs = await requirements(cookie, league);
  if (config.demoMode) {
    const s = demo.scoring(league.leagueId) || {};
    const ppr = s.ppr != null ? s.ppr : 1;
    return { numQbs: numQbs(reqs), ppr, tePpr: s.tePpr != null ? s.tePpr : ppr, pprDetected: true };
  }
  const rules = await scoringRules(cookie, league);
  return {
    numQbs: numQbs(reqs),
    ppr: rules.detected ? rules.ppr : 1,
    tePpr: rules.detected ? rules.tePpr : null,
    pprDetected: !!rules.detected,
  };
}

// A short human label for a format, e.g. "Superflex · PPR" or "1QB · Half-PPR".
function label(fmt) {
  if (!fmt) return null;
  const qb = fmt.numQbs >= 2 ? 'Superflex' : '1QB';
  const pprLabel = fmt.ppr >= 1 ? 'PPR' : fmt.ppr >= 0.5 ? 'Half-PPR' : 'Standard';
  const te = fmt.tePpr != null && fmt.tePpr > fmt.ppr ? ' · TE-premium' : '';
  return `${qb} · ${pprLabel}${te}`;
}

module.exports = { requirements, format, numQbs, scoringRules, label };
