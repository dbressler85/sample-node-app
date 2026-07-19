'use strict';
// Verifies the request-collapsing caches on the two static MFL reads that every
// cross-league screen leans on: `myleagues` (listLeagues) and a league's franchise
// names. Uncached, these fired on every call — including from inside per-league
// fan-outs — and dominated latency. Here we count the actual MFL export calls.
process.env.MFL_DEMO_MODE = 'false';

const mfl = require('../../src/lib/mfl');

const calls = {};
mfl.exportRequest = async (type, opts = {}) => {
  calls[type] = (calls[type] || 0) + 1;
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [
        { league_id: '100', name: 'Alpha', url: 'https://www10.myfantasyleague.com/2026/home/100', franchise_id: '0001' },
        { league_id: '200', name: 'Beta', url: 'https://www45.myfantasyleague.com/2026/home/200', franchise_id: '0002' },
      ] } };
    case 'league':
      return { league: { franchises: { franchise: [{ id: '0001', name: 'Me' }, { id: '0002', name: 'Them' }] } } };
    default:
      return {};
  }
};

const leaguesService = require('../../src/services/leagues');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'cookie-A';

  // listLeagues: three reads, one MFL call.
  const a = await leaguesService.listLeagues(CK);
  await leaguesService.listLeagues(CK);
  await leaguesService.listLeagues(CK);
  assert(a.length === 2, 'two leagues returned');
  assert(calls.myleagues === 1, `myleagues fetched once for repeat reads, got ${calls.myleagues}`);
  console.log(`✓ listLeagues: 3 reads -> ${calls.myleagues} MFL call`);

  // franchiseNames: repeat reads of the SAME league collapse to one call...
  const lg = a[0];
  const n1 = await leaguesService.franchiseNames(CK, lg);
  await leaguesService.franchiseNames(CK, lg);
  assert(n1.get('0002') === 'Them', 'franchise name resolved');
  assert(calls.league === 1, `same-league names fetched once, got ${calls.league}`);

  // ...but a different league is a distinct key -> a second call.
  await leaguesService.franchiseNames(CK, a[1]);
  assert(calls.league === 2, `distinct league is a separate fetch, got ${calls.league}`);
  console.log(`✓ franchiseNames: 3 reads over 2 leagues -> ${calls.league} MFL calls`);

  // A different session (cookie) must not read another account's cached leagues.
  await leaguesService.listLeagues('cookie-B');
  assert(calls.myleagues === 2, `distinct cookie triggers its own fetch, got ${calls.myleagues}`);
  console.log(`✓ cache is keyed per session (cookie), not shared across accounts`);

  console.log('\nLEAGUES CACHE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
