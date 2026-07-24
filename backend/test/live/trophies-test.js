'use strict';
// Trophy case service: demo seeds from the fixture; add validates (team/league/year required, year
// bounded), dedupes a repeat title, and sorts newest-year-first; remove is 404 on an unknown id.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-trophies-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'true';
process.env.MFL_SEASON = '2026';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const trophies = require('../../src/services/trophies');
const TK = 'tok-1';

(async () => {
  // Demo seed: the fixture championships appear, newest-year first, with a summary.
  const seeded = trophies.list(TK);
  assert(seeded.trophies.length === 3, `demo seeds 3 trophies, got ${seeded.trophies.length}`);
  assert(seeded.trophies[0].year >= seeded.trophies[1].year, 'sorted newest-year first');
  assert(seeded.summary.total === 3 && seeded.summary.latest === 2024, `summary: ${JSON.stringify(seeded.summary)}`);
  assert(seeded.trophies.every((t) => t.id && t.team && t.leagueName && t.year), 'each trophy has id/team/league/year');
  console.log('✓ demo seeds the fixture trophies (sorted, summarized)');

  // Add a new championship → appears, sorted in.
  const added = trophies.add(TK, { leagueName: 'Bestball Barons', team: 'Gridiron Ghosts', year: 2025 });
  assert(added.trophy.id && added.trophy.source === 'manual', 'add returns the stored manual trophy');
  assert(added.trophies.length === 4 && added.trophies[0].year === 2025, 'new trophy sorts to the top (2025)');
  console.log('✓ add: validated championship stored + sorted');

  // Dedup: same league + year doesn't double-add.
  const dup = trophies.add(TK, { leagueName: 'Bestball Barons', team: 'Gridiron Ghosts', year: 2025 });
  assert(dup.trophies.length === 4, 'duplicate (same league+year) is not added twice');
  console.log('✓ add: duplicate title deduped');

  // Validation: missing fields / bad year → 400.
  for (const [bad, why] of [
    [{ leagueName: 'X', year: 2024 }, 'missing team'],
    [{ team: 'X', year: 2024 }, 'missing league'],
    [{ leagueName: 'X', team: 'Y', year: 1980 }, 'year too old'],
    [{ leagueName: 'X', team: 'Y', year: 2100 }, 'year in the future'],
    [{ leagueName: 'X', team: 'Y' }, 'no year'],
  ]) {
    let threw = false;
    try { trophies.add(TK, bad); } catch (e) { threw = e.status === 400; }
    assert(threw, `rejects: ${why}`);
  }
  console.log('✓ add: validation (team/league/year required, year bounded → 400)');

  // Remove: by id works; unknown id → 404.
  const id = trophies.list(TK).trophies[0].id;
  const removed = trophies.remove(TK, id);
  assert(removed.removed === id && removed.trophies.length === 3, 'remove drops the trophy');
  let notFound = false;
  try { trophies.remove(TK, 'nope'); } catch (e) { notFound = e.status === 404; }
  assert(notFound, 'unknown id → 404');
  console.log('✓ remove: by id + 404 on unknown');

  console.log('\nTROPHIES HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
