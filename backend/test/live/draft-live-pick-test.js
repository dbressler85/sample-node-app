'use strict';
// live_draft (Misc command) wiring: making a pick posts to protocol://host/<year>/live_draft with
// CMD=DRAFT + PLAYER_PICK + ROUND + PICK, and MFL's "OK" success marker resolves as success while a
// real rejection throws with its detail. (The full makePick flow is exercised in demo by the draft
// service; this pins the new Misc-request layer that fires the live write.)
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

let lastUrl = null;
let lastInit = null;
function mock(text) {
  global.fetch = async (url, init) => {
    lastUrl = String(url);
    lastInit = init;
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => text };
  };
}

(async () => {
  // Success: MFL returns its "OK" marker; the pick is accepted.
  mock(JSON.stringify({ error: 'OK' }));
  const ok = await mfl.miscRequest('live_draft', {
    host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597',
    CMD: 'DRAFT', PLAYER_PICK: '13593', ROUND: 3, PICK: 6, JSON: 1,
  });
  assert(ok && ok.status === 'OK', 'a successful live_draft pick resolves as OK');
  // The request hit the MISC command path (…/<year>/live_draft?…), not export/import.
  assert(/\/live_draft\?/.test(lastUrl), `posts to the live_draft command, got ${lastUrl}`);
  assert(/[?&]CMD=DRAFT(&|$)/.test(lastUrl), 'CMD=DRAFT is sent');
  assert(/[?&]PLAYER_PICK=13593(&|$)/.test(lastUrl), 'PLAYER_PICK is sent');
  assert(/[?&]ROUND=3(&|$)/.test(lastUrl) && /[?&]PICK=6(&|$)/.test(lastUrl), 'ROUND + PICK match the on-the-clock slot');
  assert(/[?&]L=69597(&|$)/.test(lastUrl), 'league id is sent');
  assert(lastInit && lastInit.method === 'POST', 'the write uses POST');
  console.log('✓ live_draft posts CMD=DRAFT with player/round/pick and resolves OK');

  // A real rejection (not your pick / player gone) still throws with MFL's detail.
  mock(JSON.stringify({ error: 'It is not your turn to draft.' }));
  let threw = null;
  try {
    await mfl.miscRequest('live_draft', { host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597', CMD: 'DRAFT', PLAYER_PICK: '1', ROUND: 1, PICK: 1, JSON: 1 });
  } catch (e) { threw = e; }
  assert(threw && /not your turn/i.test(mfl.errorDetail(threw)), 'a rejected pick throws with MFL detail');
  console.log('✓ a rejected live_draft pick throws with MFL detail');

  console.log('\nLIVE DRAFT PICK HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
