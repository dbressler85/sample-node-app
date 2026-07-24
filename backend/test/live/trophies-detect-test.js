'use strict';
// Trophy auto-detect: scan each league's past seasons (via playoffs.championFor) from the last
// completed year backwards, stop at the first year with no bracket, and collect the seasons where MY
// franchise was champion. detectAndAdd stores the new ones (source:'auto') and dedupes against what's
// already in the case.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-trophydetect-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const leaguesService = require('../../src/services/leagues');
const playoffs = require('../../src/services/playoffs');
const trophies = require('../../src/services/trophies');
const TK = 'tok-detect';

// Two leagues: in L1 I'm franchise 0011 (won 2025 + 2023); in L2 I'm 0002 (never won). L1 predates
// 2022 (no bracket in 2021 → scan stops). L2 exists all years but I never win.
leaguesService.listLeagues = async () => [
  { leagueId: 'L1', name: 'Dynasty Warlords', host: 'www45.myfantasyleague.com', franchiseId: '0011', franchiseName: 'My Team' },
  { leagueId: 'L2', name: 'Superflex Sickos', host: 'www46.myfantasyleague.com', franchiseId: '0002', franchiseName: 'My Other Team' },
];

// Stub the per-season champion lookup.
const L1 = { 2025: '0011', 2024: '0007', 2023: '0011', 2022: '0004' }; // champ franchise per year; <2022 no bracket
const L2 = { 2025: '0009', 2024: '0009', 2023: '0001', 2022: '0005', 2021: '0003', 2020: '0008' };
playoffs.championFor = async (cookie, league, year) => {
  const y = Number(year);
  if (league.leagueId === 'L1') {
    if (L1[y] == null) return { exists: false, champion: null }; // 2021 and earlier → stop
    return { exists: true, champion: { franchiseId: L1[y], name: `Team ${L1[y]}`, title: 'League Champion' } };
  }
  if (L2[y] == null) return { exists: false, champion: null };
  return { exists: true, champion: { franchiseId: L2[y], name: `Team ${L2[y]}`, title: 'League Champion' } };
};

(async () => {
  // Detect (read-only): finds my two L1 titles (2025, 2023), none in L2, and stops before 2021.
  const det = await trophies.detect('ck', TK);
  assert(det.candidates.length === 2, `found 2 titles, got ${det.candidates.length}`);
  assert(det.candidates.every((c) => c.leagueId === 'L1' && c.team === 'My Team'), 'both titles are mine in L1');
  assert(det.candidates.map((c) => c.year).join(',') === '2025,2023', `years newest-first: ${det.candidates.map((c) => c.year)}`);
  assert(det.candidates.every((c) => c.alreadyInCase === false), 'nothing in the case yet');
  assert(det.summary.found === 2 && det.summary.new === 2, `summary: ${JSON.stringify(det.summary)}`);
  console.log('✓ detect: finds my championships, stops at the pre-existence year, none from leagues I didn’t win');

  // detectAndAdd: stores both (source:'auto').
  const res = await trophies.detectAndAdd('ck', TK);
  assert(res.added.length === 2 && res.added.every((t) => t.source === 'auto'), 'adds 2 auto-sourced titles');
  assert(res.trophies.length === 2 && res.summary.latest === 2025, `case now holds them: ${JSON.stringify(res.summary)}`);
  console.log('✓ detectAndAdd: stores the detected titles (source auto)');

  // Idempotent: a second run adds nothing (dedup by league+year).
  const again = await trophies.detectAndAdd('ck', TK);
  assert(again.added.length === 0 && again.trophies.length === 2, 're-running adds nothing (deduped)');
  console.log('✓ detectAndAdd: idempotent — already-detected titles aren’t duplicated');

  // A manual entry for the same league+year also dedupes against detection.
  trophies.remove(TK, res.trophies[0].id); // drop one auto title
  trophies.add(TK, { leagueName: 'Dynasty Warlords', team: 'My Team', year: 2025 }); // re-add manually (leagueId null)
  const after = await trophies.detect('ck', TK);
  const the2025 = after.candidates.find((c) => c.year === 2025);
  assert(the2025 && the2025.alreadyInCase, 'a manual same-league-name+year entry marks the detected one already-in-case');
  console.log('✓ detect: manual entry (no leagueId) still dedupes against detection by name+year');

  console.log('\nTROPHY DETECT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
