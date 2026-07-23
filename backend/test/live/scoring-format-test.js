'use strict';
// Verify live PPR is parsed from MFL scoring rules (not assumed full PPR), with a TE-premium
// detected, superflex derived from slots, and a safe full-PPR fallback when the rules can't be
// parsed. Covers audit items #4/#5.
//
// The rule shapes below mirror MFL's REAL `rules` export (verified against a live league): each
// rule is an {event, range, points} triple and every value is wrapped as {$t:"…"}. A reception is
// event "CC" and its scoring is a multiplier in `points` ("*1" = full PPR, "*.5" = half) — NOT the
// combined "1*CC" string an earlier version of this test (and the parser) wrongly assumed, which is
// why a real PPR league was mislabeled "Standard".
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');

// One superflex starting lineup (a QB|RB|WR|TE flex makes numQbs=2), reused for every league; the
// `rules` response varies per league id.
const STARTERS = { starters: { position: [
  { name: 'QB', limit: '1' },
  { name: 'QB|RB|WR|TE', limit: '1' },
  { name: 'RB|WR|TE', limit: '2' },
] } };

// MFL's {$t} wrapper + separate event/range/points fields.
const t = (s) => ({ $t: String(s) });
const rule = (event, points, range = '0-99') => ({ event: t(event), range: t(range), points: t(points) });

mfl.exportRequest = async (type, opts = {}) => {
  if (type === 'league') return { league: STARTERS };
  if (type === 'rules') {
    switch (opts.L) {
      case 'FULL': // the real-world case: all skill positions in one group, "*1" on CC
        return { rules: { positionRules: [
          { positions: 'QB|RB|WR|TE|PK', rule: [rule('PY', '*.05', '-50-999'), rule('CC', '*1'), rule('RY', '*.1', '-50-999')] },
        ] } };
      case 'HALF':
        return { rules: { positionRules: [{ positions: 'RB|WR|TE', rule: [rule('RY', '*.1', '-50-999'), rule('CC', '*.5')] }] } };
      case 'TEP':
        return { rules: { positionRules: [
          { positions: 'RB|WR', rule: [rule('CC', '*1')] },
          { positions: 'TE', rule: [rule('CC', '*1.5')] },
        ] } };
      case 'STD':
        return { rules: { positionRules: [{ positions: 'RB|WR|TE', rule: [rule('RY', '*.1', '-50-999')] }] } }; // no CC -> 0 PPR
      case 'LEGACY': // tolerate an older combined "coef*CC" points string, just in case
        return { rules: { positionRules: [{ positions: 'RB|WR|TE', rule: [{ points: '.5*CC' }] }] } };
      default:
        return {}; // no rules at all -> undetectable
    }
  }
  return {};
};

const leagueFormat = require('../../src/lib/leagueformat');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const lg = (id) => ({ leagueId: id, host: 'h', franchiseId: '0001' });

(async () => {
  // The exact real-world shape from the DataForce league: full PPR, superflex — must NOT be "Standard".
  const full = await leagueFormat.format('ck', lg('FULL'));
  console.log('FULL:', JSON.stringify(full), '->', leagueFormat.label(full));
  assert(full.pprDetected === true, 'full-PPR detected from the real {$t} event/points shape');
  assert(full.ppr === 1, `ppr 1, got ${full.ppr}`);
  assert(full.numQbs === 2, 'superflex derived from slots');
  assert(leagueFormat.label(full) === 'Superflex · PPR', `label, got "${leagueFormat.label(full)}"`);

  // Half-PPR, superflex.
  const half = await leagueFormat.format('ck', lg('HALF'));
  console.log('HALF:', JSON.stringify(half), '->', leagueFormat.label(half));
  assert(half.pprDetected === true && half.ppr === 0.5, `ppr 0.5, got ${half.ppr}`);
  assert(leagueFormat.label(half) === 'Superflex · Half-PPR', `label, got "${leagueFormat.label(half)}"`);

  // Full PPR base with a TE premium.
  const tep = await leagueFormat.format('ck', lg('TEP'));
  console.log('TEP:', JSON.stringify(tep), '->', leagueFormat.label(tep));
  assert(tep.ppr === 1 && tep.tePpr === 1.5, `ppr 1 / tePpr 1.5, got ${tep.ppr}/${tep.tePpr}`);
  assert(leagueFormat.label(tep) === 'Superflex · PPR · TE-premium', `TE-prem label, got "${leagueFormat.label(tep)}"`);

  // Standard (a reception-less rule set) -> detected with ppr 0.
  const std = await leagueFormat.format('ck', lg('STD'));
  console.log('STD:', JSON.stringify(std), '->', leagueFormat.label(std));
  assert(std.pprDetected === true && std.ppr === 0, `standard ppr 0, got ${std.ppr}`);
  assert(leagueFormat.label(std) === 'Superflex · Standard', `standard label, got "${leagueFormat.label(std)}"`);

  // Legacy combined "coef*CC" string still parses via the fallback.
  const legacy = await leagueFormat.format('ck', lg('LEGACY'));
  console.log('LEGACY:', JSON.stringify(legacy), '->', leagueFormat.label(legacy));
  assert(legacy.ppr === 0.5, `legacy combined form parses to 0.5, got ${legacy.ppr}`);

  // No parseable rules -> safe full-PPR fallback, flagged undetected.
  const unknown = await leagueFormat.format('ck', lg('NONE'));
  console.log('NONE:', JSON.stringify(unknown));
  assert(unknown.pprDetected === false && unknown.ppr === 1, `falls back to full PPR undetected, got ${unknown.ppr}`);

  console.log('\nSCORING-FORMAT DETECTION TEST PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
