'use strict';

// League format detection: starting requirements + the two dimensions that most
// change dynasty value — superflex (numQbs) and PPR. Used to fetch format-aware
// FantasyCalc values, and shared by the lineup service so slot parsing lives once.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('./mfl');
const playersLib = require('./players');
const { createMemo } = require('./memo');

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

// Full starting-lineup spec: the per-slot rules AND the league's authoritative TOTAL starter count.
// MFL's `starters` node carries a `count` attribute (e.g. "10") that is the number of players you
// ACTUALLY start — which, for a min-max lineup, is LESS than the sum of the per-position maximums
// (e.g. 1QB + up-to-3RB + up-to-5WR + 1TE + 1K + 1DEF sums to 12 maxes but the league starts 10).
// Each slot keeps `min`/`max` (from a "1-3" style limit) plus `count` = max for optimizer back-compat.
//   { slots: [{ name, eligible[], count, min, max }], total }
const startersMemo = createMemo({ ttlMs: config.mflStaticTtlMs });

function startersSpec(cookie, league) {
  if (config.demoMode) {
    const slots = (demo.lineupRequirements(league.leagueId) || []).map((r) => ({ ...r, min: r.count || 1, max: r.count || 1 }));
    const demoTotal = demo.starterTotal ? demo.starterTotal(league.leagueId) : null;
    return Promise.resolve({ slots, total: demoTotal != null ? demoTotal : slots.reduce((s, r) => s + (r.count || 0), 0) });
  }
  return startersMemo.get(`${cookie}|${league.leagueId}`, () => buildStartersSpec(cookie, league));
}

async function buildStartersSpec(cookie, league) {
  const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
  const startersNode = res && res.league && res.league.starters;
  const positions = mfl.toArray(startersNode && startersNode.position);
  const slots = positions.map((p) => {
    const eligible = mfl.text(p.name)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => playersLib.normalizePosition(s));
    // MFL limits can be a range ("1-3"): keep both ends. `count` stays the MAX for the optimizer,
    // while min/max let the UI say "up to 3" and the league total (below) says how many really start.
    const rawLimit = mfl.text(p.limit) || '1';
    const parts = rawLimit.split('-');
    const min = parseInt(parts[0], 10) || 0;
    const max = parseInt(parts[parts.length - 1], 10) || 1;
    return { name: slotName(eligible), eligible, count: max, min, max };
  });
  // The authoritative total: MFL's `starters count`. Fall back to the sum of maxes only if absent
  // (a lineup with no ranges — where the two are equal anyway).
  const totalAttr = mfl.num(startersNode && startersNode.count);
  const total = totalAttr && totalAttr > 0 ? totalAttr : slots.reduce((s, r) => s + (r.max || 0), 0);
  const sumMax = slots.reduce((s, r) => s + (r.max || 0), 0);
  if (total !== sumMax) console.log(`[leagueformat] league=${league.leagueId} total starters=${total} (sum of position maxes=${sumMax} — min-max lineup)`);
  return { slots, total };
}

// Normalized starting-lineup requirements: [{ name, eligible[], count, min, max }].
async function requirements(cookie, league) {
  return (await startersSpec(cookie, league)).slots;
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
// MFL's `rules` export returns per-position scoring rules. Each rule is a triple:
// an `event` stat code, a `range`, and a `points` multiplier — and MFL JSON wraps
// every value in {$t:"…"}. A reception is the event `CC`, and its points read like
// "*1" (full PPR), "*.5" (half) or the rule is absent (standard). So the real shape
// (verified against a live league) is e.g.:
//   {"event":{"$t":"CC"},"range":{"$t":"0-99"},"points":{"$t":"*1"}}
// NOT the combined "1*CC" string an earlier version assumed. We read the per-reception
// coefficient for the skill positions — that, with superflex, is what changes FantasyCalc
// dynasty value. League rules change rarely, so we cache per league (MFL's own guidance
// is to cache rules/scoring).
const RECEPTION_EVENT = 'CC'; // MFL abbreviation for a reception
const rulesCache = new Map(); // leagueId -> { at, data }
const RULES_TTL_MS = 6 * 60 * 60 * 1000;

// Unwrap MFL's {$t:"…"} JSON text wrapper to a plain string (tolerant of a bare string too).
function txt(v) {
  if (v == null) return '';
  if (typeof v === 'object') return v.$t != null ? String(v.$t) : '';
  return String(v);
}

// Per-reception points for one rule. MFL keeps the event code in `event` and the scoring as a
// multiplier in `points` (e.g. "*1", "*.5"), so a reception rule is event==="CC" and its points
// magnitude IS the PPR coefficient. Tolerates the older combined "coef*CC"/"CC*coef" string form
// too, so a differently-packed league still parses.
function receptionPoints(rule) {
  if (!rule) return 0;
  const event = txt(rule.event).trim().toUpperCase();
  const points = txt(rule.points).trim();
  if (event === RECEPTION_EVENT) {
    const m = points.match(/-?\d*\.?\d+/); // "*1" -> 1, "*.5" -> .5, "3" -> 3
    return m ? Number(m[0]) || 0 : 0;
  }
  // Fallback: a combined formula packed into points ("1*CC" / "CC*.5").
  let m = points.match(new RegExp(`(\\d*\\.?\\d+)\\s*\\*\\s*${RECEPTION_EVENT}\\b`));
  if (!m) m = points.match(new RegExp(`\\b${RECEPTION_EVENT}\\s*\\*\\s*(\\d*\\.?\\d+)`));
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
      const positions = txt(g.positions).split('|').map((s) => s.trim()).filter(Boolean);
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
// format() (and the requirements() parse it awaits) are recomputed by every
// service that touches a league on a screen — several redundant re-parses of the
// same league per request. The underlying league/rules reads are HTTP-cached;
// memoize the derived format per (cookie, league) on the static TTL. Slots and
// scoring rules are slow-changing and no in-app write alters them, so no
// invalidation is needed.
const formatMemo = createMemo({ ttlMs: config.mflStaticTtlMs });

async function format(cookie, league) {
  if (config.demoMode) return buildFormat(cookie, league);
  return formatMemo.get(`${cookie}|${league.leagueId}`, () => buildFormat(cookie, league));
}

async function buildFormat(cookie, league) {
  if (config.demoMode) {
    const reqs = await requirements(cookie, league);
    const s = demo.scoring(league.leagueId) || {};
    const ppr = s.ppr != null ? s.ppr : 1;
    // The demo scoring fixture states the TE bump as `tePremium` (extra points per TE
    // reception); tePpr is the TE's total per-reception points.
    const tePpr = s.tePpr != null ? s.tePpr : ppr + (s.tePremium || 0);
    return { numQbs: numQbs(reqs), ppr, tePpr, pprDetected: true };
  }
  // Roster requirements and scoring rules are independent reads — fetch in parallel.
  const [reqs, rules] = await Promise.all([requirements(cookie, league), scoringRules(cookie, league)]);
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

module.exports = { requirements, startersSpec, format, numQbs, scoringRules, label };
