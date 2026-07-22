'use strict';

// Contract for the MFL repository layer (src/lib/mflRepo.js) — the one place that now owns the
// "export type -> envelope path" unwrap that used to be copy-pasted across ~15 services. This
// pins each reader so a wrong path, a dropped param, or a lost single-object-to-array
// normalization fails here instead of silently returning [] to a screen. exportRequest is
// stubbed (no network); we assert what the repo asks MFL for and how it unwraps the reply.

const mfl = require('../../src/lib/mfl');
const mflRepo = require('../../src/lib/mflRepo');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const league = { host: 'www55.myfantasyleague.com', leagueId: '0001', franchiseId: '0002' };
const cookie = 'CK';

// Canned envelope per export type. Two deliberately use the SINGLE-object shape MFL returns for a
// one-element collection, to prove toArray normalization.
const ENVELOPES = {
  rosters: { rosters: { franchise: [{ id: '0001' }, { id: '0002' }] } },
  leagueStandings: { leagueStandings: { franchise: { id: '0001' } } }, // single -> [one]
  league: { league: { franchises: { franchise: [{ id: '1', name: 'Alpha' }] } } },
  pendingTrades: { pendingTrades: { pendingTrade: [{ trade_id: 't1' }] } },
  liveScoring: { liveScoring: { week: '3', franchise: [{ id: '1', score: '10' }] } },
  freeAgents: { freeAgents: { leagueUnit: { player: [{ id: 'p1' }] } } },
  draftResults: { draftResults: { draftUnit: { unit: 'LEAGUE', draftPick: [] } } }, // single -> [one]
  playerScores: { playerScores: { playerScore: [{ id: 'p1', score: '5' }] } },
  projectedScores: { projectedScores: { playerScore: [{ id: 'p1', score: '9' }] } },
  schedule: { schedule: { weeklySchedule: [{ week: '1' }] } },
  calendar: { calendar: { event: [{ type: 'lock' }] } },
  tradeBait: { tradeBaits: { tradeBait: [{ franchise_id: '1' }] } }, // type != envelope key
  transactions: { transactions: { transaction: [{ type: 'TRADE' }] } },
};

let calls = [];
const origExport = mfl.exportRequest;
mfl.exportRequest = async (type, params) => {
  calls.push({ type, params });
  return ENVELOPES[type] || {};
};

function lastCall() {
  return calls[calls.length - 1];
}

(async () => {
  // Every reader must issue host + L + cookie from the league; the array readers return an array.
  const cases = [
    ['rosters', () => mflRepo.rosters(league, cookie), 'rosters', 2],
    ['standings', () => mflRepo.standings(league, cookie), 'leagueStandings', 1],
    ['leagueFranchises', () => mflRepo.leagueFranchises(league, cookie), 'league', 1],
    ['pendingTrades', () => mflRepo.pendingTrades(league, cookie), 'pendingTrades', 1],
    ['liveScoring', () => mflRepo.liveScoring(league, cookie), 'liveScoring', 1],
    ['freeAgentUnits', () => mflRepo.freeAgentUnits(league, cookie), 'freeAgents', 1],
    ['draftResults', () => mflRepo.draftResults(league, cookie), 'draftResults', 1],
    ['playerScores', () => mflRepo.playerScores(league, cookie), 'playerScores', 1],
    ['projectedScores', () => mflRepo.projectedScores(league, cookie), 'projectedScores', 1],
    ['schedule', () => mflRepo.schedule(league, cookie), 'schedule', 1],
    ['calendar', () => mflRepo.calendar(league, cookie), 'calendar', 1],
    ['tradeBaits', () => mflRepo.tradeBaits(league, cookie), 'tradeBait', 1],
    ['transactions', () => mflRepo.transactions(league, cookie), 'transactions', 1],
  ];

  for (const [name, run, expectType, expectLen] of cases) {
    const out = await run();
    const c = lastCall();
    assert(c.type === expectType, `${name} issues the '${expectType}' export (got '${c.type}')`);
    assert(c.params.host === league.host, `${name} sends league host`);
    assert(c.params.L === league.leagueId, `${name} sends L=leagueId`);
    assert(c.params.cookie === cookie, `${name} sends the cookie`);
    assert(Array.isArray(out), `${name} returns an array`);
    assert(out.length === expectLen, `${name} unwraps the right envelope path (len ${expectLen}, got ${out.length})`);
  }

  // Single-object envelopes normalize to a one-element array (MFL's one-vs-many shape).
  assert((await mflRepo.standings(league, cookie))[0].id === '0001', 'standings: single object -> [object]');
  assert((await mflRepo.draftResults(league, cookie))[0].unit === 'LEAGUE', 'draftResults: single unit -> [unit]');

  // Nested / renamed paths land on the right child.
  assert((await mflRepo.leagueFranchises(league, cookie))[0].name === 'Alpha', 'leagueFranchises: league.franchises.franchise');
  assert((await mflRepo.tradeBaits(league, cookie))[0].franchise_id === '1', 'tradeBaits: tradeBait export -> tradeBaits.tradeBait envelope');

  // Extra params pass through verbatim (FRANCHISE / W / PLAYERS the services rely on).
  await mflRepo.rosters(league, cookie, { FRANCHISE: '0009' });
  assert(lastCall().params.FRANCHISE === '0009', 'rosters forwards FRANCHISE');
  await mflRepo.schedule(league, cookie, { W: 7 });
  assert(lastCall().params.W === 7, 'schedule forwards W');
  await mflRepo.playerScores(league, cookie, { W: 2, PLAYERS: 'p1' });
  assert(lastCall().params.W === 2 && lastCall().params.PLAYERS === 'p1', 'playerScores forwards W + PLAYERS');

  // Defensive: a missing/empty envelope yields [] (never throws, never null) — the services'
  // .find()/.map() on the result stay safe.
  mfl.exportRequest = async () => ({});
  for (const [name, run] of cases.map(([n, r]) => [n, r])) {
    const out = await run();
    assert(Array.isArray(out) && out.length === 0, `${name}: empty envelope -> []`);
  }

  mfl.exportRequest = origExport; // restore, just in case

  console.log('✓ mflRepo: 13 readers — envelope paths, host/L/cookie, param passthrough, single->array, empty-safe');
  console.log('\nMFL REPO HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
