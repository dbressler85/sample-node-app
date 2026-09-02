'use strict';

// Consumer-side scoping: in a MULTI-COPY league, an all-franchise scan must keep only MY division's
// franchises; in a normal league it must keep EVERY franchise (byte-for-byte today's behavior). This
// exercises the real code path of rosterService.leagueFranchises (the "which rival would want this
// player" source that feeds trade-bait suggestions), so a field-name slip (f.id) or a missing
// multiCopy guard is caught — not just the pure includes() predicate.

const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-divscope-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');
const leaguesService = require('../../src/services/leagues');
const leagueFormat = require('../../src/lib/leagueformat');
const enrichmentLib = require('../../src/lib/enrichment');
const divisionContext = require('../../src/lib/divisionContext');

const LEAGUE = { leagueId: 'DIV1', host: 'www10.myfantasyleague.com', franchiseId: '0001', name: 'Copy League' };
leaguesService.listLeagues = async () => [LEAGUE];
leaguesService.franchiseNames = async () => new Map([['0001', 'Me'], ['0002', 'DivMate'], ['0003', 'OtherDivA'], ['0004', 'OtherDivB']]);
leagueFormat.format = async () => ({ numQbs: 1, ppr: 1, tePpr: 1 });
enrichmentLib.snapshot = async () => ({ value: () => 10 });

// rosters: 4 franchises. 0001/0002 are division 00, 0003/0004 are division 01. MULTI-COPY: divisions
// 00 and 01 roster the SAME player ids (1,2,3 / 4,5,6), so every player appears in both divisions.
const ROSTERS = { rosters: { franchise: [
  { id: '0001', player: [{ id: '1' }, { id: '2' }, { id: '3' }] },
  { id: '0002', player: [{ id: '4' }, { id: '5' }, { id: '6' }] },
  { id: '0003', player: [{ id: '1' }, { id: '2' }, { id: '3' }] },
  { id: '0004', player: [{ id: '4' }, { id: '5' }, { id: '6' }] },
] } };
// The `league` export franchise directory carries the division attribute per franchise.
function leagueExport(divisions) {
  return { league: { franchises: { franchise: [
    { id: '0001', division: divisions ? '00' : undefined },
    { id: '0002', division: divisions ? '00' : undefined },
    { id: '0003', division: divisions ? '01' : undefined },
    { id: '0004', division: divisions ? '01' : undefined },
  ] } } };
}

let withDivisions = true;
mfl.exportRequest = async (type) => {
  if (type === 'rosters') return ROSTERS;
  if (type === 'league') return leagueExport(withDivisions);
  return {};
};

const rosterService = require('../../src/services/roster');

(async () => {
  // MULTI-COPY: franchises tagged into 2 divisions, whole pool duplicated across them → multiCopy=true.
  // leagueFranchises must return only MY division (0001 + 0002), never the other division (0003/0004).
  withDivisions = true;
  divisionContext.invalidate('ck', 'DIV1');
  const scoped = await rosterService.leagueFranchises('ck', 'DIV1');
  const ids = scoped.map((f) => f.franchiseId).sort();
  assert(ids.length === 2, `multi-copy scopes to my division (2 franchises), got ${ids.length}: ${ids.join(',')}`);
  assert(ids[0] === '0001' && ids[1] === '0002', `keeps my-division franchises only, got ${ids.join(',')}`);
  console.log('✓ multi-copy: leagueFranchises scoped to my division (0001, 0002)');

  // NORMAL league: no division attributes → multiCopy stays false → every franchise kept (no regression).
  withDivisions = false;
  divisionContext.invalidate('ck', 'DIV1');
  const all = await rosterService.leagueFranchises('ck', 'DIV1');
  assert(all.length === 4, `normal league keeps ALL franchises, got ${all.length}`);
  console.log('✓ normal league: leagueFranchises keeps every franchise (no regression)');

  console.log('\nDIVISION SCOPING HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
