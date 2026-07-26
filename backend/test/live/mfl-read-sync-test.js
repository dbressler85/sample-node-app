'use strict';
// Device-origin spike (docs/DEVICE_ORIGIN_MFL.md): the shared MFL read core (URL builder + parse +
// primitives) that the mobile app will use to fetch a read straight from MFL on-device, using the
// SAME code the backend uses. This guards:
//   1. the mobile copy is in sync with the canonical (drift guard, like trade-math),
//   2. the shared parse PRIMITIVES behave identically to lib/mfl.js (no divergence between the two),
//   3. buildExportUrl emits MFL's exact export URL (host-guarded, JSON=1, cookie NOT in the URL),
//   4. the rosters descriptor parses the envelope the same as the backend repo,
//   5. the on-device shape applies the id/text rules (fid padding, $t-safe strings).
process.env.MFL_DEMO_MODE = 'false';

const fs = require('fs');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const { generate, CANONICAL, MOBILE } = require('../../scripts/sync-mfl-read');
const mflRead = require('../../src/lib/mflRead');
const mfl = require('../../src/lib/mfl');

// 1. The committed mobile copy is exactly what the sync script would produce now.
const canonicalSrc = fs.readFileSync(CANONICAL, 'utf8');
const mobileSrc = fs.readFileSync(MOBILE, 'utf8');
assert(mobileSrc === generate(canonicalSrc), 'mobile/src/mflRead.js is stale — run `npm run sync:mfl-read`');
assert(generate(canonicalSrc + '\n// tweak') !== mobileSrc, 'drift comparison is live (a change would fail)');
console.log('✓ mobile copy in sync with the canonical');

// 2. Parse primitives match lib/mfl.js exactly (the two must never diverge).
const cases = [null, undefined, '5', 5, '0005', { $t: '12' }, { $t: 'FP_0005_2027_1' }, '', 'N/A', { nope: 1 }];
for (const v of cases) {
  assert(mflRead.text(v) === mfl.text(v), `text() parity for ${JSON.stringify(v)}`);
  assert(mflRead.fid(v) === mfl.fid(v), `fid() parity for ${JSON.stringify(v)}`);
}
assert(mflRead.num('12') === 12 && mflRead.num('', 0) === 0 && mflRead.num({ $t: '3.5' }) === 3.5, 'num() behaves');
assert(JSON.stringify(mflRead.toArray({ a: 1 })) === JSON.stringify([{ a: 1 }]) && mflRead.toArray(null).length === 0, 'toArray() behaves');
console.log('✓ parse primitives match lib/mfl.js (text/num/fid/toArray)');

// 3. buildExportUrl: exact MFL export URL, host-guarded, JSON=1, no credential in the URL.
const url = mflRead.buildExportUrl({ host: 'www49.myfantasyleague.com', year: '2026', type: 'rosters', league: '15188', params: { FRANCHISE: '0003' } });
assert(url === 'https://www49.myfantasyleague.com/2026/export?TYPE=rosters&L=15188&FRANCHISE=0003&JSON=1', `export URL shape, got ${url}`);
assert(!/MFL_USER_ID|COOKIE|APIKEY/i.test(url), 'the credential is never in the URL (sent as a header)');
let threw = false;
try { mflRead.buildExportUrl({ host: 'evil.example.com', year: '2026', type: 'rosters', league: '1' }); } catch (e) { threw = /non-MyFantasyLeague/.test(e.message); }
assert(threw, 'a non-MFL host is refused (SSRF guard travels with the shared core)');
assert(mflRead.isMflHost('www49.myfantasyleague.com') && !mflRead.isMflHost('evil.com'), 'isMflHost guards correctly');
console.log('✓ buildExportUrl emits MFL\'s export URL, host-guarded, credential-free');

// 4. The rosters descriptor: request() builds the read, parse() unwraps the envelope like the repo.
const req = mflRead.reads.rosters.request({ host: 'www10.myfantasyleague.com', year: '2026', league: 'L1' });
assert(req.needsAuth === true && /TYPE=rosters&L=L1/.test(req.url), 'rosters.request builds an authed URL');
const envelope = { rosters: { franchise: [{ id: '0001', player: [{ id: '14080', status: 'starter' }] }, { id: '0002', player: { id: '9', status: 'nonstarter' } }] } };
const parsed = mflRead.reads.rosters.parse(envelope);
assert(Array.isArray(parsed) && parsed.length === 2 && parsed[0].id === '0001', 'rosters.parse returns the franchise array');
// Parity with what the backend repo returns for the same envelope (mfl.toArray of the same path).
const repoEquivalent = mfl.toArray(envelope.rosters.franchise);
assert(JSON.stringify(parsed) === JSON.stringify(repoEquivalent), 'shared parse matches the backend repo unwrap');
console.log('✓ rosters descriptor: request + parse (matches the backend repo)');

// 5. On-device shape applies the correctness rules (fid padding, $t-safe fields, single→array player).
const shaped = mflRead.shapeRoster({ id: '3', player: { id: { $t: '14080' }, status: 'starter' } });
assert(shaped.franchiseId === '0003', `franchise id padded to 4 digits, got ${shaped.franchiseId}`);
assert(shaped.players.length === 1 && shaped.players[0].id === '14080' && shaped.players[0].status === 'starter', 'player id/status unwrapped from $t');
console.log('✓ shapeRoster applies fid padding + $t-safe fields');

// 6. readWith(): the device's actual read — build URL, fetch with cookie + registered UA via the
//    injected fetch, parse; a 429 throws and is NOT retried.
(async () => {
  const calls = [];
  const okFetch = async (u, init) => { calls.push({ u, init }); return { ok: true, status: 200, json: async () => envelope }; };
  const rows = await mflRead.readWith(okFetch, { descriptor: mflRead.reads.rosters, host: 'www10.myfantasyleague.com', year: '2026', league: 'L1', cookie: 'CK', userAgent: 'DynastyCentral/1.0' });
  assert(calls.length === 1 && /TYPE=rosters&L=L1/.test(calls[0].u), 'readWith hits the rosters URL once');
  assert(calls[0].init.headers.Cookie === 'MFL_USER_ID=CK', 'cookie sent as the MFL_USER_ID header (not in the URL)');
  assert(calls[0].init.headers['User-Agent'] === 'DynastyCentral/1.0', 'registered UA sent on the device read');
  assert(Array.isArray(rows) && rows.length === 2 && rows[0].id === '0001', 'readWith parsed the rosters envelope');

  let n = 0;
  const rl = async () => { n += 1; return { ok: false, status: 429, json: async () => ({}) }; };
  let threw = false;
  try {
    await mflRead.readWith(rl, { descriptor: mflRead.reads.rosters, host: 'www10.myfantasyleague.com', year: '2026', league: 'L1' });
  } catch (e) { threw = e.status === 429; }
  assert(threw && n === 1, 'a 429 throws and is NOT retried (per MFL: retrying makes it worse)');
  console.log('✓ readWith: builds URL + sends cookie/UA + parses; 429 throws without retry');

  // 7. enrichRoster(): join device franchises with the backend player dictionary → screen shape.
  const franchises = [{ franchiseId: '0001', players: [{ id: '30', status: 'starter' }, { id: '20', status: 'nonstarter' }] }];
  const dict = {
    30: { name: 'Best, Available', position: 'RB', team: 'BBB', value: 95 },
    20: { name: 'Drafted, Guy', position: 'WR', team: 'AAA', value: 40 },
  };
  const enriched = mflRead.enrichRoster(franchises, dict);
  assert(enriched[0].players[0].id === '30' && enriched[0].players[0].name === 'Best, Available', 'joins names + sorts by value desc');
  assert(enriched[0].players[0].position === 'RB' && enriched[0].players[0].status === 'starter', 'carries position + the device roster status');
  assert(enriched[0].totalValue === 135 && enriched[0].count === 2, 'totalValue summed, count set');
  const missing = mflRead.enrichRoster([{ franchiseId: '0002', players: [{ id: '999', status: 'x' }] }], dict);
  assert(missing[0].players[0].name === null && missing[0].players[0].value === null, 'a player missing from the dict → null fields, not a crash');
  console.log('✓ enrichRoster: joins device rosters + player dict, value-sorted, missing-safe');

  // 8. assembleTeams(): device franchises + player dict + franchise directory → the full teams payload.
  const dir = { franchises: { '0001': 'Team Alpha', '0002': 'Team Beta' }, mine: '0002' };
  const dev = [
    { franchiseId: '0001', players: [{ id: '30', status: 'STARTER' }, { id: '20', status: 'INJURED_RESERVE' }] },
    { franchiseId: '0002', players: [{ id: '31', status: 'TAXI_SQUAD' }] },
  ];
  const dict2 = { 30: { name: 'A', position: 'RB', team: 'X', value: 90 }, 20: { name: 'B', position: 'WR', team: 'Y', value: 30 }, 31: { name: 'C', position: 'QB', team: 'Z', value: 50 } };
  const asm = mflRead.assembleTeams(dev, dict2, dir);
  assert(asm.teams.length === 2 && asm.teams[0].franchiseId === '0001', 'teams sorted by value desc (0001=120 > 0002=50)');
  assert(asm.teams[0].name === 'Team Alpha' && asm.teams[1].mine === true, 'team names + mine come from the directory');
  assert(asm.teams[0].players[0].slot === 'active' && asm.teams[0].players[1].slot === 'ir', 'slot from status (STARTER→active, INJURED_RESERVE→ir)');
  assert(asm.teams[1].players[0].slot === 'taxi', 'TAXI_SQUAD → taxi');
  let athrew = false;
  try { mflRead.assembleTeams(dev, dict2, { franchises: { '0001': 'Team Alpha' }, mine: '0002' }); } catch (e) { athrew = true; }
  assert(athrew, 'a team missing its name THROWS → the caller falls back to the backend (never a broken render)');
  console.log('✓ assembleTeams: names/mine/slot + value sort; incomplete → throws for fallback');

  // 9. assembleStandings(): device leagueStandings rows (rank order) + directory → standings payload.
  const sdir = { franchises: { '0001': 'Alpha', '0002': 'Beta', '0003': 'Gamma' }, mine: '0002', playoffSpots: 1 };
  const srows = [
    { id: '0001', h2hw: '2', h2hl: '0', h2ht: '0', pf: '250.5', pa: '200' },
    { id: '0002', h2hw: '1', h2hl: '1', pf: '210', pa: '215.4' },
    { id: '0003', h2hw: '0', h2hl: '2', pf: '190', pa: '235' },
  ];
  const st = mflRead.assembleStandings(srows, sdir);
  assert(st.standings.length === 3 && st.standings[0].rank === 1 && st.standings[0].name === 'Alpha', 'rank = export order; names from directory');
  assert(st.standings[0].record === '2-0' && st.standings[0].pointsFor === 250.5, 'record built + pf rounded');
  assert(st.standings[1].mine === true && st.me && st.me.franchiseId === '0002', 'mine flagged + me resolved');
  assert(st.standings[0].inPlayoffs === true && st.standings[1].inPlayoffs === false, 'playoff line from playoffSpots=1');
  let sthrew = false;
  try { mflRead.assembleStandings([{ id: '9999', h2hw: '1' }], sdir); } catch (e) { sthrew = true; }
  assert(sthrew, 'a row missing its name THROWS → backend fallback');
  console.log('✓ assembleStandings: rank/record/pf + mine + playoff line; incomplete → throws');

  // 10. parseTransactions(): split each raw row's payload into structured ids (add/drop + TRADE).
  const traw = [
    { type: 'FREE_AGENT', timestamp: '1700000000', franchise: '0001', transaction: '30,|20,' },
    { type: 'TRADE', timestamp: '1700000100', franchise: '0001', transaction: '20,FP_0003_2027_1,|31,|3' },
  ];
  const tparsed = mflRead.parseTransactions(traw);
  assert(tparsed[0].type === 'FREE_AGENT' && tparsed[0].addedIds[0] === '30' && tparsed[0].droppedIds[0] === '20', 'add/drop payload split into added|dropped');
  assert(tparsed[1].type === 'TRADE' && tparsed[1].withFranchiseId === '0003' && tparsed[1].droppedIds.join(',') === '20,FP_0003_2027_1' && tparsed[1].addedIds[0] === '31', 'TRADE payload → gave|received|withFranchise (fid-padded)');
  console.log('✓ parseTransactions: add/drop + TRADE payloads split into structured ids');

  // 11. assembleTransactions(): raw rows + asset dict (players AND pick tokens) + directory → feed.
  const tdir = { franchises: { '0001': 'Alpha', '0003': 'Gamma' }, mine: '0001' };
  const tdict = {
    30: { name: 'Add, Guy', position: 'RB' }, 20: { name: 'Drop, Guy', position: 'WR' },
    31: { name: 'Trade, Guy', position: 'QB' }, FP_0003_2027_1: { name: '2027 1st (Gamma)', position: 'PICK' },
  };
  const tasm = mflRead.assembleTransactions(traw, tdict, tdir);
  assert(tasm.transactions.length === 2, 'one row per raw transaction');
  assert(tasm.transactions[0].typeLabel === 'Free agent' && tasm.transactions[0].franchise.name === 'Alpha', 'type labeled + franchise named from directory');
  assert(tasm.transactions[1].withFranchise.name === 'Gamma' && tasm.transactions[1].dropped[1].name === '2027 1st (Gamma)', 'TRADE names both sides + resolves pick token via the asset dict');
  const tmissing = mflRead.assembleTransactions(traw, {}, tdir); // unresolved asset → id fallback, not a throw
  assert(tmissing.transactions[0].added[0].name === '30', 'an unresolved asset falls back to its id (feed, not a scoreboard)');
  let tthrew = false;
  try { mflRead.assembleTransactions(traw, tdict, { franchises: {} }); } catch (e) { tthrew = true; }
  assert(tthrew, 'an empty franchise directory THROWS → the caller falls back to the backend');
  console.log('✓ assembleTransactions: names + pick tokens + type labels; empty directory → throws');

  // 12. exposureBucket: full status vocabulary, starter kept DISTINCT from bench (unlike rosterSlot).
  assert(mflRead.exposureBucket('STARTER') === 'starter' && mflRead.rosterSlot('STARTER') === 'active', 'exposureBucket keeps STARTER distinct where rosterSlot folds it to active');
  assert(mflRead.exposureBucket('INJURED_RESERVE') === 'ir' && mflRead.exposureBucket('TS') === 'taxi' && mflRead.exposureBucket('nonstarter') === 'bench', 'ir/taxi/bench tokens bucket correctly');

  // 13. assembleExposure: device per-league rosters + enrichment dict → the cross-league exposure feed.
  const exRosters = [
    { leagueId: 'A', name: 'Alpha', players: [{ id: '30', status: 'STARTER' }, { id: '20', status: 'INJURED_RESERVE' }] },
    { leagueId: 'B', name: 'Beta', players: [{ id: '30', status: 'nonstarter' }] },
  ];
  const exDict = {
    30: { name: 'Star, Guy', position: 'RB', team: 'X', age: 24, value: 90, availability: null, seasonPoints: 120.5, weekProjection: 15.2, tag: 'target', watched: true },
    20: { name: 'Hurt, Guy', position: 'WR', team: 'Y', age: 29, value: 20, availability: { kind: 'out' }, seasonPoints: null, weekProjection: null, tag: null, watched: false },
  };
  const ex = mflRead.assembleExposure(exRosters, exDict, 3);
  assert(ex.players[0].id === '30' && ex.players[0].count === 2 && ex.players[0].startingCount === 1, 'a player is grouped across leagues (count=2, startingCount=1)');
  assert(ex.players[0].exposurePct === 67 && ex.players[0].leagues[0].bucket === 'starter' && ex.players[0].leagues[1].starting === false, 'exposurePct over totalLeagues; per-league bucket + starting flag');
  assert(ex.players[0].value === 90 && ex.players[0].seasonPoints === 120.5 && ex.players[0].tag === 'target' && ex.players[0].watched === true, 'enrichment (value/points/tag/watched) attached from the dict');
  assert(ex.summary.uniquePlayers === 2 && ex.summary.multiLeague === 1, 'summary counts unique + multi-league players');
  let exthrew = false;
  try { mflRead.assembleExposure(exRosters, {}, 3); } catch (e) { exthrew = true; }
  assert(exthrew, 'a non-empty roster with an empty enrichment dictionary THROWS → backend fallback');
  console.log('✓ assembleExposure: cross-league grouping + enrichment + summary; empty dict → throws');

  console.log('\nMFL-READ SHARED-CORE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
