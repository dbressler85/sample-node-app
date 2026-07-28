'use strict';
// Outlook-aware trade verdict. The shared tradeMath now carries a second (win-now / redraft) read of
// a deal alongside the dynasty read, and leadingLens() lets a team's OUTLOOK decide which one leads
// the verdict. This proves the classic contender trap: "ship a proven vet for youth + a pick" is
// dynasty-FAVORABLE but win-now-UNFAVORABLE, and a win-now team is judged on the latter.
const tradeMath = require('../../src/lib/tradeMath');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

// From MY perspective: I RECEIVE a young WR (big dynasty, modest win-now) + a rookie pick (win-now 0),
// and SEND a proven RB (mid dynasty, elite win-now). Assets carry both `value` (dynasty) and `winNow`.
const receive = [
  { position: 'WR', value: 82, winNow: 24 },
  { position: 'PICK', value: 28, winNow: 0 },
];
const send = [{ position: 'RB', value: 72, winNow: 96 }];

(async () => {
  const a = tradeMath.analyze(receive, send);

  // Dynasty read (top-level, unchanged): I come out ahead on assets.
  assert(a.verdict === 'favorable', `dynasty read is favorable (net ${a.net}), got ${a.verdict}`);
  // Win-now sub-read exists and is negative — I shipped this season's production.
  assert(a.winNow && a.winNow.verdict === 'unfavorable', `win-now read is unfavorable, got ${a.winNow && a.winNow.verdict}`);
  assert(a.winNow.net < 0, `win-now net is negative (${a.winNow.net})`);
  console.log(`✓ same deal reads favorable on dynasty (net ${a.net}) but unfavorable on win-now (net ${a.winNow.net})`);

  // A contender (outlook 'win-now') is judged on the win-now read — the deal is a warning, not a win.
  const contender = tradeMath.leadingLens(a, 'win-now');
  assert(contender.lens === 'winNow' && contender.verdict === 'unfavorable', `contender leads on win-now/unfavorable, got ${contender.lens}/${contender.verdict}`);
  console.log('✓ a win-now team leads on the win-now read → the deal is flagged unfavorable');

  // A rebuilder leads on dynasty value — for them the same deal is genuinely favorable.
  const rebuilder = tradeMath.leadingLens(a, 'rebuilding');
  assert(rebuilder.lens === 'dynasty' && rebuilder.verdict === 'favorable', `rebuilder leads on dynasty/favorable, got ${rebuilder.lens}/${rebuilder.verdict}`);
  console.log('✓ a rebuilding team leads on dynasty value → the same deal is favorable for them');

  // No win-now data on any asset → no win-now read, and leadingLens safely falls back to dynasty.
  const plain = tradeMath.analyze([{ position: 'WR', value: 50 }], [{ position: 'RB', value: 40 }]);
  assert(plain.winNow === null, 'no winNow on assets → winNow read is null');
  assert(tradeMath.leadingLens(plain, 'win-now').lens === 'dynasty', 'leadingLens falls back to dynasty when there is no win-now read');
  console.log('✓ falls back to the dynasty read when no asset carries win-now value');

  console.log('\nWIN-NOW VERDICT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
