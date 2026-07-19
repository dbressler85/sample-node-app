'use strict';

// League format detection: starting requirements + the two dimensions that most
// change dynasty value — superflex (numQbs) and PPR. Used to fetch format-aware
// FantasyCalc values, and shared by the lineup service so slot parsing lives once.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('./mfl');
const playersLib = require('./players');

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
    const max = parseInt(String(p.limit || '1').split('-').pop(), 10) || 1;
    return { name: eligible.length > 1 ? 'FLEX' : eligible[0] || 'FLEX', eligible, count: max };
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

// { numQbs, ppr } for a league. PPR comes from the demo scoring in demo; live
// scoring rules aren't parsed, so we assume full PPR (the dynasty norm) — the
// superflex dimension, which matters most for value, is always derived for real.
async function format(cookie, league) {
  const reqs = await requirements(cookie, league);
  const ppr = config.demoMode ? (() => {
    const s = demo.scoring(league.leagueId) || {};
    return s.ppr != null ? s.ppr : 1;
  })() : 1;
  return { numQbs: numQbs(reqs), ppr };
}

module.exports = { requirements, format, numQbs };
