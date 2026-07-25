'use strict';
// Sunday pre-warm worker (#3): one warm pass primes the lineup-relevant reads for every DISTINCT
// league across active sessions (deduped), each at LOW priority, so it never delays a real user and a
// league shared by two members is warmed once. Plus: the ET game-day window predicate is correct
// across days and both DST seasons.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');
const nfl = require('../../src/lib/nfl');
const players = require('../../src/lib/players');
const leagues = require('../../src/services/leagues');
const sessions = require('../../src/store/sessions');

// Two active sessions; A and B both belong to L2 (a shared league).
sessions.active = () => [{ cookie: 'ckA', username: 'a' }, { cookie: 'ckB', username: 'b' }];
leagues.listLeagues = async (cookie) =>
  cookie === 'ckA'
    ? [{ leagueId: 'L1', host: 'h' }, { leagueId: 'L2', host: 'h' }]
    : [{ leagueId: 'L2', host: 'h' }, { leagueId: 'L3', host: 'h' }];
nfl.currentWeek = async () => 5;
players.load = async () => new Map();

const rec = [];
mfl.exportRequest = async (type, opts) => { rec.push(`${type}:${opts.L || ''}:${opts.priority || 'normal'}`); return {}; };
mflRepo.rosters = async (lg, ck, p) => { rec.push(`rosters:${lg.leagueId}:${(p || {}).priority}`); return []; };
mflRepo.freeAgentUnits = async (lg, ck, p) => { rec.push(`fa:${lg.leagueId}:${(p || {}).priority}`); return []; };
mflRepo.projectedScores = async (lg, ck, p) => { rec.push(`proj:${lg.leagueId}:${(p || {}).priority}`); return []; };
mflRepo.schedule = async (lg, ck, p) => { rec.push(`sched:${lg.leagueId}:${(p || {}).priority}`); return []; };

const warm = require('../../src/services/warm');

(async () => {
  const res = await warm.warmOnce();
  assert(res.sessions === 2, `2 active sessions, got ${res.sessions}`);
  assert(res.leagues === 3, `L1, L2, L3 deduped to 3 distinct leagues (L2 shared), got ${res.leagues}`);

  // The shared league L2 is warmed exactly ONCE, at low priority.
  assert(rec.filter((r) => r === 'rosters:L2:low').length === 1, 'shared league L2 warmed once');
  for (const L of ['L1', 'L2', 'L3']) {
    assert(rec.includes(`rosters:${L}:low`), `${L} rosters warmed at low priority`);
    assert(rec.includes(`proj:${L}:low`), `${L} projections warmed`);
    assert(rec.includes(`league:${L}:low`), `${L} settings warmed at low priority`);
  }
  // EVERYTHING the worker issues is low priority — it must never contend with user reads.
  assert(rec.every((r) => r.endsWith(':low')), `all warm reads are low priority, got ${JSON.stringify([...new Set(rec.map((r) => r.split(':').pop()))])}`);
  console.log(`✓ warm pass: 3 distinct leagues (L2 shared→once), ${rec.length} reads, all low priority`);

  // ET game-day window: check the predicate against its own ET reading across many instants (diverse
  // days + both DST seasons), so a parsing regression is caught without hardcoding DST offsets.
  const partsOf = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(d);
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let checked = 0, sundaysInWindow = 0;
  for (const iso of ['2026-01-04', '2026-09-13', '2026-11-01', '2026-01-07', '2026-10-04']) {
    for (let h = 0; h < 24; h++) {
      const d = new Date(`${iso}T${String(h).padStart(2, '0')}:30:00Z`);
      const p = partsOf(d);
      let hour = parseInt(p.find((x) => x.type === 'hour').value, 10); if (hour === 24) hour = 0;
      const weekday = WD[p.find((x) => x.type === 'weekday').value];
      const expected = weekday === 0 && hour >= 6 && hour < 14;
      assert(warm.inWindow(d) === expected, `inWindow(${d.toISOString()}) should be ${expected} (ET ${weekday}/${hour}h)`);
      checked += 1;
      if (expected) sundaysInWindow += 1;
    }
  }
  assert(sundaysInWindow > 0, 'at least some Sunday-morning instants land in the window');
  console.log(`✓ ET game-day window: ${checked} instants match spec, ${sundaysInWindow} inside the Sun 6am–2pm ET window`);

  console.log('\nWARM HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
