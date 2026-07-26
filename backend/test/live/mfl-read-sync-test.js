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

console.log('\nMFL-READ SHARED-CORE HARNESS PASSED');
