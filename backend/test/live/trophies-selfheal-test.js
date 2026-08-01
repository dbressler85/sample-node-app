'use strict';
// Trophy self-heal: re-running "Find my titles" corrects a stale/wrong `place` on an AUTO trophy —
// e.g. one added before the podium feature, when every finish defaulted to gold — without adding a
// duplicate, and WITHOUT ever overwriting a manual entry. This is the fix for "all my trophies look
// gold, some should be silver/bronze": a re-scan now re-grades them to the reconstructed finish.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-trophyheal-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const leaguesService = require('../../src/services/leagues');
const playoffs = require('../../src/services/playoffs');
const trophies = require('../../src/services/trophies');
const TK = 'tok-heal';

leaguesService.listLeagues = async () => [
  { leagueId: 'L1', name: 'Dynasty Warlords', host: 'www45.myfantasyleague.com', franchiseId: '0011', franchiseName: 'My Team' },
];

// The reconstruction, stubbed. 2024 flips between "I'm the champion" (phase 1) and "I'm the runner-up"
// (phase 2) so we can prove a stale gold gets re-graded. 2023 always reads me as 3rd (for the manual
// guard). 2022 and earlier: no bracket → the scan stops.
let mode = 'champ';
playoffs.championFor = async (cookie, league, year) => {
  const y = Number(year);
  if (y === 2025) return { exists: true, champion: { franchiseId: '0007' }, runnerUp: null, third: null }; // not mine
  if (y === 2024) {
    return mode === 'champ'
      ? { exists: true, champion: { franchiseId: '0011' }, runnerUp: null, third: null } // I "won"
      : { exists: true, champion: { franchiseId: '0007' }, runnerUp: { franchiseId: '0011' }, third: null }; // really 2nd
  }
  if (y === 2023) return { exists: true, champion: { franchiseId: '0007' }, runnerUp: { franchiseId: '0005' }, third: { franchiseId: '0011' } }; // I'm 3rd
  return { exists: false, champion: null, runnerUp: null, third: null };
};

(async () => {
  // A MANUAL gold the owner entered for 2023 (they'll insist it's a title). It must survive every scan.
  trophies.add(TK, { team: 'My Team', leagueName: 'Dynasty Warlords', year: 2023, place: 1, source: 'manual' });

  // Phase 1: the scan mis-reads 2024 as a championship → stored as an auto GOLD. 2023 matches the
  // existing MANUAL entry, so it's neither added nor corrected.
  mode = 'champ';
  const first = await trophies.detectAndAdd('ck', TK);
  assert(first.added.length === 1 && first.added[0].year === 2024 && first.added[0].place === 1, `phase 1 adds 2024 as gold, got ${JSON.stringify(first.added)}`);
  assert(first.corrected.length === 0, `phase 1 corrects nothing, got ${JSON.stringify(first.corrected)}`);
  const m2023a = first.trophies.find((t) => t.year === 2023);
  assert(m2023a && m2023a.place === 1 && m2023a.source === 'manual', 'the manual 2023 gold is untouched');
  console.log('✓ phase 1: 2024 stored as 1st (gold); manual 2023 left alone');

  // Phase 2: reconstruction now correctly reads me as the RUNNER-UP in 2024. Re-scan self-heals.
  mode = 'runner';
  const second = await trophies.detectAndAdd('ck', TK);
  assert(second.added.length === 0, `phase 2 adds no duplicate, got ${second.added.length}`);
  assert(second.corrected.length === 1 && second.corrected[0].year === 2024 && second.corrected[0].place === 2, `phase 2 re-grades 2024 to 2nd, got ${JSON.stringify(second.corrected)}`);
  const t2024 = second.trophies.find((t) => t.year === 2024);
  assert(t2024 && t2024.place === 2, `stored 2024 medal is now 2nd (silver), got ${t2024 && t2024.place}`);
  assert(second.trophies.filter((t) => t.year === 2024).length === 1, 'still exactly one 2024 trophy (no dup)');
  // The manual 2023, which the scan reads as 3rd, is STILL a gold — a manual entry is never overwritten.
  const m2023b = second.trophies.find((t) => t.year === 2023);
  assert(m2023b && m2023b.place === 1, `the manual 2023 gold is NOT auto-downgraded, got place=${m2023b && m2023b.place}`);
  console.log('✓ phase 2: stale gold re-graded to 2nd (silver), no dup, manual entry protected');

  console.log('\nTROPHY SELF-HEAL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
