'use strict';
// Dynasty values are LEAGUE-SPECIFIC: a QB is worth far more in a superflex/2QB league,
// and a TE is worth more in a TE-premium league (extra points per reception). This proves
// the enrichment value multipliers apply per format (in demo, where base values are flat,
// so the effect is entirely attributable to the format adjustment).
process.env.MFL_DEMO_MODE = 'true';

const enrichment = require('../../src/lib/enrichment');
const leagueFormat = require('../../src/lib/leagueformat');
const leagues = require('../../src/services/leagues');
const players = require('../../src/lib/players');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const ls = await leagues.listLeagues('demo');
  const byId = await players.load('demo');
  const oneQb = ls.find((l) => l.leagueId === '64097');   // 1QB, standard
  const superflex = ls.find((l) => l.leagueId === '40750'); // superflex (2 QB slots)
  const tePrem = ls.find((l) => l.leagueId === '19622');    // TE-premium (+0.5/rec)

  const fmt1 = await leagueFormat.format('demo', oneQb);
  const fmtSF = await leagueFormat.format('demo', superflex);
  const fmtTE = await leagueFormat.format('demo', tePrem);
  console.log('formats:', JSON.stringify({ oneQb: fmt1, superflex: fmtSF, tePrem: fmtTE }));
  assert(fmtSF.numQbs === 2, 'superflex league detects 2 QB slots');
  assert(fmtTE.tePpr > fmtTE.ppr, 'TE-premium league has tePpr above ppr');

  const e1 = await enrichment.snapshot(fmt1, 'demo');
  const eSF = await enrichment.snapshot(fmtSF, 'demo');
  const eTE = await enrichment.snapshot(fmtTE, 'demo');

  const firstOf = (pos) => { for (const [id, p] of byId.entries()) if (p.position === pos) return id; return null; };
  const qb = firstOf('QB');
  const te = firstOf('TE');
  const wr = firstOf('WR');

  // Superflex QB premium.
  console.log('QB', byId.get(qb).name, '1QB', e1.value(qb), 'superflex', eSF.value(qb));
  assert(eSF.value(qb) > e1.value(qb) * 1.4, `QB worth much more in superflex (${e1.value(qb)} -> ${eSF.value(qb)})`);

  // TE premium.
  console.log('TE', byId.get(te).name, 'standard', eSF.value(te), 'TE-prem', eTE.value(te));
  assert(eTE.value(te) > eSF.value(te), `TE worth more in a TE-premium league (${eSF.value(te)} -> ${eTE.value(te)})`);

  // A WR is unaffected by the QB/TE multipliers (sanity — the premium is position-specific).
  console.log('WR', byId.get(wr).name, '1QB', e1.value(wr), 'superflex', eSF.value(wr));
  assert(e1.value(wr) === eSF.value(wr), 'WR value is not moved by the superflex QB premium');

  console.log('✓ league-specific value: superflex lifts QBs, TE-premium lifts TEs, WRs unchanged');
  console.log('\nFORMAT VALUE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
