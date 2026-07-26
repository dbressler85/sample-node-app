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

  console.log('\nMFL-READ SHARED-CORE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
