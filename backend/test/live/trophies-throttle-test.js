'use strict';
// Regression: "I had to tap Find my titles several times to load all my trophies." A transient throttle
// on ONE season's read used to look identical to "no bracket that year," so the backward scan STOPPED
// there and every earlier season was silently missed — a later tap (warm/cleared window) got further.
// Now a read failure (championFor ok:false) is retried and, if still failing, only flips `partial`; it
// never truncates the scan, so an older championship past the throttled season is still found in one tap.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-trophythrottle-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const leaguesService = require('../../src/services/leagues');
const playoffs = require('../../src/services/playoffs');
const trophies = require('../../src/services/trophies');
const TK = 'tok-throttle';

leaguesService.listLeagues = async () => [
  { leagueId: 'L1', name: 'Old Dynasty', host: 'www45.myfantasyleague.com', franchiseId: '0011', franchiseName: 'My Team' },
];

// 2025: no title (someone else won). 2024: the read FAILS the first two times (throttle), then succeeds
// and shows I'm the champion. 2023: I'm the champion too — reachable ONLY if the 2024 failure didn't
// truncate the scan. 2022: no bracket → the scan legitimately stops.
let attempts2024 = 0;
playoffs.championFor = async (cookie, league, year) => {
  const y = Number(year);
  if (y === 2025) return { ok: true, exists: true, champion: { franchiseId: '0007' }, runnerUp: null, third: null };
  if (y === 2024) {
    attempts2024 += 1;
    if (attempts2024 <= 2) return { ok: false, exists: false, champion: null, runnerUp: null, third: null }; // throttled
    return { ok: true, exists: true, champion: { franchiseId: '0011' }, runnerUp: null, third: null }; // I won
  }
  if (y === 2023) return { ok: true, exists: true, champion: { franchiseId: '0011' }, runnerUp: null, third: null }; // I won
  return { ok: true, exists: false, champion: null, runnerUp: null, third: null }; // 2022 and earlier: no bracket
};

(async () => {
  const res = await trophies.detectAndAdd('ck', TK);
  const years = res.added.map((t) => t.year).sort();
  // Both my championships are found in ONE scan — the retried 2024 AND the 2023 that sits behind it.
  assert(res.added.length === 2, `both titles found in one scan, got ${res.added.length}: ${JSON.stringify(res.added.map((t) => t.year))}`);
  assert(years[0] === 2023 && years[1] === 2024, `found 2023 + 2024, got ${years.join(',')}`);
  assert(attempts2024 >= 3, `the throttled 2024 read was retried (not given up on), attempts=${attempts2024}`);
  assert(res.partial === false, `nothing was left unread, so partial is false, got ${res.partial}`);
  console.log('✓ a throttled season is retried and never truncates the scan — both titles found in one tap');

  console.log('\nTROPHY THROTTLE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
