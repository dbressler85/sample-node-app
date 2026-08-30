'use strict';

// Player profile — full-season game-by-game schedule with projected + actual points, scored on a FIXED
// basis we compute ourselves (full PPR, with a TE-premium toggle) off Sleeper's per-week raw stat lines
// rather than a league's own scoring. Past weeks carry the ACTUAL, the current week carries BOTH (a
// pre-game projection and the live/final actual), upcoming weeks carry the PROJECTION, byes are marked.
// The TE-premium toggle (+0.5/reception for TEs) is verified end-to-end against the same stat line.

const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-sched-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';
process.env.MFL_SEASON = '2026';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const enrichmentLib = require('../../src/lib/enrichment');

// Player '9' is a TE on team AAA, joined to Sleeper id SLP9 via the crosswalk.
const PLAYER = { id: '9', name: 'Test, TightEnd', position: 'TE', team: 'AAA' };
enrichmentLib.snapshot = async () => ({ sleeperId: (id) => (String(id) === '9' ? 'SLP9' : null) });

// Full-season schedule (W=ALL): AAA home vs BBB (wk1), @CCC (wk2), home vs DDD (wk3), bye (wk4).
const FULL = { fullNflSchedule: { nflSchedule: [
  { week: '1', matchup: [{ team: [{ id: 'BBB' }, { id: 'AAA' }] }] }, // away first → AAA home vs BBB
  { week: '2', matchup: [{ team: [{ id: 'AAA' }, { id: 'CCC' }] }] }, // AAA away @ CCC
  { week: '3', matchup: [{ team: [{ id: 'DDD' }, { id: 'AAA' }] }] }, // AAA home vs DDD
  { week: '4', matchup: [{ team: [{ id: 'EEE' }, { id: 'FFF' }] }] }, // AAA on bye
] } };

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'players': return { players: { player: [PLAYER] } };
    case 'nflSchedule':
      return String(opts.W) === 'ALL' ? FULL : { nflSchedule: { week: '3', matchup: FULL.fullNflSchedule.nflSchedule[2].matchup } };
    default: return {};
  }
};

// Sleeper per-week raw stat lines (keyed by Sleeper id). Actuals for weeks 1-3, a projection for the
// live week 3. A WR-style line so the receptions drive the PPR / TE-premium delta.
const ACT = {
  1: { rec: 5, rec_yd: 80, rec_td: 1 }, // 5 + 8 + 6 = 19.0 PPR ; +2.5 (5×0.5) = 21.5 TEP
  2: { rec: 7, rec_yd: 100, rec_td: 0 }, // 7 + 10 = 17.0 PPR ; 20.5 TEP
  3: { rec: 6, rec_yd: 90, rec_td: 1 }, // 6 + 9 + 6 = 21.0 PPR ; 24.0 TEP
};
const PROJ = { 3: { rec: 5, rec_yd: 70, rec_td: 0 } }; // 5 + 7 = 12.0 PPR ; 14.5 TEP

global.fetch = async (url) => {
  const m = String(url).match(/\/(stats|projections)\/nfl\/regular\/2026\/(\d+)/);
  let body = {};
  if (m) {
    const week = Number(m[2]);
    const stat = m[1] === 'projections' ? PROJ[week] : ACT[week];
    if (stat) body = { SLP9: stat };
  }
  return { ok: true, json: async () => body };
};

const hub = require('../../src/services/playerhub');

(async () => {
  // --- default basis: full PPR, no TE premium -------------------------------------------------------
  const r = await hub.gameSchedule('ck', 'tk', '9');
  assert(r.playerId === '9' && r.team === 'AAA', 'carries player id + team');
  assert(r.tep === false, 'default basis is PPR (tep off)');
  assert(/PPR/.test(r.scoring) && !/TE\+/.test(r.scoring), `scoring label reads PPR without TE premium, got "${r.scoring}"`);
  assert(r.weeks.length === 4, `one row per scheduled week, got ${r.weeks.length}`);
  const [w1, w2, w3, w4] = r.weeks;

  assert(w1.week === 1 && w1.opp === 'BBB' && w1.home === true, `wk1 home vs BBB, got ${JSON.stringify(w1)}`);
  assert(w1.actual === 19.0 && w1.projected == null, `wk1 (past) PPR actual only, got ${JSON.stringify(w1)}`);

  assert(w2.opp === 'CCC' && w2.home === false && w2.actual === 17.0, `wk2 (past) away @CCC PPR actual, got ${JSON.stringify(w2)}`);

  assert(w3.week === 3 && w3.opp === 'DDD', `wk3 opp, got ${JSON.stringify(w3)}`);
  assert(w3.projected === 12.0 && w3.actual === 21.0, `wk3 (current) shows BOTH projection and live actual, got ${JSON.stringify(w3)}`);

  assert(w4.bye === true && w4.opp == null && w4.projected == null && w4.actual == null, `wk4 bye row, got ${JSON.stringify(w4)}`);
  console.log('✓ PPR basis: past→actual, current→proj+actual, future→proj, bye handled');

  // --- TE-premium toggle: +0.5 per reception for this TE, same stat lines ---------------------------
  const t = await hub.gameSchedule('ck', 'tk', '9', { tep: '1' });
  assert(t.tep === true, 'tep=1 turns the TE-premium basis on');
  assert(/TE\+0\.5/.test(t.scoring), `scoring label reads the TE premium, got "${t.scoring}"`);
  const [tw1, , tw3] = t.weeks;
  assert(tw1.actual === 21.5, `wk1 TEP actual adds 0.5×5 rec (19.0 → 21.5), got ${tw1.actual}`);
  assert(tw3.projected === 14.5 && tw3.actual === 24.0, `wk3 TEP proj 14.5 + actual 24.0, got ${JSON.stringify(tw3)}`);
  console.log('✓ TE-premium toggle recomputes +0.5/reception off the same stat lines');

  console.log('\nPLAYER SCHEDULE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
