'use strict';
// Verifies the full-season schedule optimization: a caller that needs several weeks
// (upcomingOpponents loops 4) is served by ONE `nflSchedule?W=ALL` fetch instead of one
// request per week, and falls back to a single-week fetch when W=ALL is unavailable.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const nfl = require('../../src/lib/nfl');

// Future kickoffs (nextKickoff only surfaces games at/after now).
const nowSec = Math.floor(Date.now() / 1000);
const KICK = { 1: nowSec + 10000, 2: nowSec + 20000, 3: nowSec + 30000, 4: nowSec + 40000 };

// W=ALL envelope: fullNflSchedule.nflSchedule[] = [{ week, matchup[] }] (away team first).
const ALL = { fullNflSchedule: { nflSchedule: [
  { week: '1', matchup: [{ kickoff: String(KICK[1]), gameSecondsRemaining: '3600', team: [{ id: 'NEP', isHome: '0' }, { id: 'SEA', isHome: '1' }] }] },
  { week: '2', matchup: [{ kickoff: String(KICK[2]), gameSecondsRemaining: '3600', team: [{ id: 'BUF', isHome: '0' }, { id: 'NEP', isHome: '1' }] }] },
  { week: '3', matchup: [{ kickoff: String(KICK[3]), gameSecondsRemaining: '3600', team: [{ id: 'NEP', isHome: '0' }, { id: 'NYJ', isHome: '1' }] }] },
  { week: '4', matchup: [{ kickoff: String(KICK[4]), gameSecondsRemaining: '3600', team: [{ id: 'MIA', isHome: '0' }, { id: 'NEP', isHome: '1' }] }] },
] } };

const calls = [];
mfl.exportRequest = async (type, opts = {}) => {
  if (type !== 'nflSchedule') return {};
  calls.push(String(opts.W));
  if (String(opts.W) === 'ALL') return ALL;
  // single-week fallback shape
  const wk = ALL.fullNflSchedule.nflSchedule.find((w) => Number(w.week) === Number(opts.W));
  return { nflSchedule: { week: String(opts.W), matchup: wk ? wk.matchup : [] } };
};

(async () => {
  nfl._resetWeekCache();

  // upcomingOpponents over 4 weeks → ONE W=ALL fetch, no per-week fan-out.
  const opps = await nfl.upcomingOpponents('ck', 'NEP', 1, 4);
  assert(calls.length === 1 && calls[0] === 'ALL', `4 weeks served by one W=ALL fetch, got calls=${JSON.stringify(calls)}`);
  const line = opps.map((o) => `${o.week}:${o.opp}`).join(' ');
  assert(line === '1:@SEA 2:BUF 3:@NYJ 4:MIA', `opponents+home/away resolved from W=ALL, got "${line}"`);
  console.log('✓ upcomingOpponents: 4 weeks from a single W=ALL fetch —', line);

  // A later single-week read (week 3) is already cached from the W=ALL load → no new fetch.
  const k3 = await nfl.nextKickoff('ck', 3);
  assert(calls.length === 1, 'week 3 kickoff served from the cached W=ALL data, no extra fetch');
  assert(k3 === new Date(KICK[3] * 1000).toISOString(), `week 3 kickoff from W=ALL, got ${k3}`);
  console.log('✓ per-week reads hit the cached full-season data');

  // Fallback: when W=ALL yields nothing, scheduleMatchups drops to a single-week request.
  nfl._resetWeekCache();
  calls.length = 0;
  const EMPTY_ALL = { fullNflSchedule: { nflSchedule: [] } };
  mfl.exportRequest = async (type, opts = {}) => {
    if (type !== 'nflSchedule') return {};
    calls.push(String(opts.W));
    if (String(opts.W) === 'ALL') return EMPTY_ALL;
    return { nflSchedule: { week: String(opts.W), matchup: [{ kickoff: String(nowSec + 50000), team: [{ id: 'NEP', isHome: '0' }, { id: 'SEA', isHome: '1' }] }] } };
  };
  const k = await nfl.nextKickoff('ck', 2);
  assert(calls.includes('ALL') && calls.includes('2'), `fell back to single-week fetch, got ${JSON.stringify(calls)}`);
  assert(k === new Date((nowSec + 50000) * 1000).toISOString(), `fallback week returned its kickoff, got ${k}`);
  console.log('✓ fallback: empty W=ALL → single-week fetch still works');

  console.log('\nNFL W=ALL SCHEDULE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
