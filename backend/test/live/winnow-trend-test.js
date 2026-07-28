'use strict';
// Win-now lens + value momentum. FantasyCalc's rows carry redraftValue (this-season value) and
// trend30Day (30-day value delta) alongside the dynasty value. This proves the snapshot exposes them:
// (1) winNow is normalized by its OWN max, so a redraft stud tops the win-now lens even if a young
// dynasty asset outranks him in dynasty value; (2) valueTrend carries FantasyCalc's signed 30-day
// momentum on the 0-100 scale; (3) both are null when FantasyCalc omits them.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const mfl = require('../../src/lib/mfl');
mfl.exportRequest = async (type) => (type === 'players' ? { players: { player: [] } } : {});

// A young dynasty stud (top dynasty value, modest redraft) and a proven vet (lower dynasty, top
// redraft) — so the two lenses disagree, which is the whole point of a win-now view.
const FC = [
  { player: { mflId: 'YOUTH', sleeperId: 'sY', position: 'WR', name: 'Young Stud', maybeAge: 22 }, value: 10000, redraftValue: 5000, trend30Day: 300, overallRank: 1 },
  { player: { mflId: 'VET', sleeperId: 'sV', position: 'RB', name: 'Proven Vet', maybeAge: 29 }, value: 6000, redraftValue: 8000, trend30Day: -400, overallRank: 5 },
  { player: { mflId: 'FLAT', sleeperId: 'sF', position: 'TE', name: 'No Extras', maybeAge: 27 }, value: 3000 }, // no redraft / trend fields
];
global.fetch = async (url) => {
  if (/fantasycalc/.test(String(url))) return { ok: true, status: 200, json: async () => FC };
  return { ok: true, status: 200, json: async () => [] };
};

const enrichment = require('../../src/lib/enrichment');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const enr = await enrichment.snapshot({ numQbs: 1, ppr: 1, tePpr: 1, numTeams: 12 }, 'ck');

  // Dynasty vs win-now disagree: youth wins dynasty, the vet wins win-now.
  const youthDyn = enr.value('YOUTH');
  const vetDyn = enr.value('VET');
  const youthWin = enr.winNow('YOUTH');
  const vetWin = enr.winNow('VET');
  console.log({ youthDyn, vetDyn, youthWin, vetWin });

  // 1) win-now is normalized by its OWN max — the vet (redraft 8000, the max) tops the win-now lens.
  assert(youthDyn > vetDyn, `youth leads dynasty value (${youthDyn} > ${vetDyn})`);
  assert(vetWin > youthWin, `the vet leads the win-now lens (${vetWin} > ${youthWin})`);
  assert(vetWin === 100, `win-now is self-normalized: the redraft max = 100 (got ${vetWin})`);
  console.log('✓ dynasty and win-now lenses disagree as designed (youth wins dynasty, vet wins win-now)');

  // 2) value momentum carries FantasyCalc's signed 30-day delta on the 0-100 scale.
  const youthTrend = enr.valueTrend('YOUTH');
  const vetTrend = enr.valueTrend('VET');
  assert(youthTrend > 0 && vetTrend < 0, `momentum is signed (youth ${youthTrend} rising, vet ${vetTrend} falling)`);
  console.log(`✓ 30-day value momentum is signed and normalized (youth ${youthTrend}, vet ${vetTrend})`);

  // 3) missing fields → null (the player with no redraft / trend data).
  assert(enr.winNow('FLAT') == null, `a player with no redraftValue has null win-now (got ${enr.winNow('FLAT')})`);
  assert(enr.valueTrend('FLAT') == null, `a player with no trend30Day has null momentum (got ${enr.valueTrend('FLAT')})`);
  console.log('✓ win-now / momentum are null when FantasyCalc omits them');

  console.log('\nWIN-NOW + TREND HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
