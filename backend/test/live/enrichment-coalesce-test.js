'use strict';
// In-flight coalescing: on a cold cache, a burst of concurrent snapshot() calls across MANY formats
// (a 15-league account spans several) must NOT stampede the external providers. The format-
// independent ones (Sleeper trending, MFL topOwns, MFL topAdds) fire ONCE even across distinct
// formats; FantasyCalc is per-format, so it fires once PER distinct format (correct — different data).
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

let fcCalls = 0;
let sleeperCalls = 0;
let mflCalls = 0; // topOwns + topAdds together (both go through mfl.exportRequest -> fetch)

// Count fetches per provider; a small delay keeps all callers in-flight together so coalescing is
// actually exercised (without it they'd each miss the cache and fetch).
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('fantasycalc')) fcCalls += 1;
  else if (u.includes('sleeper')) sleeperCalls += 1;
  else if (u.includes('TYPE=topOwns') || u.includes('TYPE=topAdds')) mflCalls += 1;
  await new Promise((r) => setTimeout(r, 25));
  // MFL exports read res.text(); the external JSON providers read res.json().
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => [], text: async () => '{}' };
};

const enrichment = require('../../src/lib/enrichment');

(async () => {
  const formats = [
    { numQbs: 1, ppr: 1, tePpr: 1 },
    { numQbs: 2, ppr: 1, tePpr: 1 },
    { numQbs: 1, ppr: 0.5, tePpr: 0.5 },
    { numQbs: 2, ppr: 0.5, tePpr: 0.5 },
    { numQbs: 1, ppr: 0, tePpr: 0 },
  ];
  // Fire them ALL at once on a cold cache — the stampede case.
  await Promise.all(formats.map((f) => enrichment.snapshot(f, 'ck')));

  console.log(`fetches — fantasycalc=${fcCalls} sleeper=${sleeperCalls} mfl(topOwns+topAdds)=${mflCalls}`);
  assert(sleeperCalls === 1, `Sleeper trending fetched once across all formats, got ${sleeperCalls}`);
  assert(fcCalls === formats.length, `FantasyCalc fetched once per distinct format (${formats.length}), got ${fcCalls}`);
  // topOwns + topAdds are each format-independent → 2 total (one apiece), not 2×formats.
  assert(mflCalls === 2, `MFL ownership + adds fetched once each (2 total), got ${mflCalls}`);
  console.log('✓ cold-start burst coalesces the shared providers (1 Sleeper, 2 MFL) instead of stampeding');

  console.log('\nENRICHMENT COALESCE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
