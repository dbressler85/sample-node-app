'use strict';
// Verify live PPR is parsed from MFL scoring rules (not assumed full PPR), with
// a TE-premium detected, superflex derived from slots, and a safe full-PPR
// fallback when the rules can't be parsed. Covers audit items #4/#5.
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');

// One superflex starting lineup (a QB|RB|WR|TE flex makes numQbs=2), reused for
// every league; the `rules` response varies per league id.
const STARTERS = { starters: { position: [
  { name: 'QB', limit: '1' },
  { name: 'QB|RB|WR|TE', limit: '1' },
  { name: 'RB|WR|TE', limit: '2' },
] } };

mfl.exportRequest = async (type, opts = {}) => {
  if (type === 'league') return { league: STARTERS };
  if (type === 'rules') {
    switch (opts.L) {
      case 'HALF':
        return { rules: { positionRules: [{ positions: 'RB|WR|TE', rule: [{ points: '.1*RY' }, { points: '.5*CC' }] }] } };
      case 'TEP':
        return { rules: { positionRules: [
          { positions: 'RB|WR', rule: [{ points: '1*CC' }] },
          { positions: 'TE', rule: [{ points: '1.5*CC' }] },
        ] } };
      case 'STD':
        return { rules: { positionRules: [{ positions: 'RB|WR|TE', rule: [{ points: '.1*RY' }] }] } }; // no CC -> 0 PPR
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
  // Half-PPR, superflex.
  const half = await leagueFormat.format('ck', lg('HALF'));
  console.log('HALF:', JSON.stringify(half), '->', leagueFormat.label(half));
  assert(half.pprDetected === true, 'half-PPR detected');
  assert(half.ppr === 0.5, `ppr 0.5, got ${half.ppr}`);
  assert(half.numQbs === 2, 'superflex derived from slots');
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

  // No parseable rules -> safe full-PPR fallback, flagged undetected.
  const unknown = await leagueFormat.format('ck', lg('NONE'));
  console.log('NONE:', JSON.stringify(unknown));
  assert(unknown.pprDetected === false, 'undetected when rules absent');
  assert(unknown.ppr === 1, `falls back to full PPR, got ${unknown.ppr}`);

  console.log('\nSCORING-FORMAT DETECTION TEST PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
