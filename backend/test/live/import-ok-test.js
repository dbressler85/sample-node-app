'use strict';
// MFL's import/transaction endpoints report their RESULT in the same field whether the write
// succeeded or FAILED: success comes back as the literal message "OK" ({"error":"OK"} with JSON=1,
// or <status>OK</status> when JSON=1 is ignored). rawRequest throws on any `error`/non-JSON body,
// so a *successful* waiver claim was surfacing to the user as "rejected the claim: OK". This pins
// that importRequest treats the "OK" marker as success while still throwing on a real rejection.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

function mockBody(text) {
  global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => text });
}

(async () => {
  // 1) JSON success marker: {"error":"OK"} — MFL overloads `error` as the result field.
  mockBody(JSON.stringify({ error: 'OK' }));
  const r1 = await mfl.importRequest('blindBidWaiverRequest', { host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597', PICKS: '1_12_2' });
  assert(r1 && r1.status === 'OK', 'JSON {"error":"OK"} resolves as success');
  console.log('✓ {"error":"OK"} → success');

  // 2) Non-JSON (JSON=1 ignored) success: <status>OK</status>.
  mockBody('<status>OK</status>');
  const r2 = await mfl.importRequest('fcfsWaiver', { host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597', ADD: '1' });
  assert(r2 && r2.status === 'OK', '<status>OK</status> resolves as success');
  console.log('✓ <status>OK</status> → success');

  // 3) Trailing punctuation / whitespace still counts as OK.
  mockBody('<status>OK.</status>');
  const r3 = await mfl.importRequest('fcfsWaiver', { host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597', ADD: '1' });
  assert(r3 && r3.status === 'OK', '"OK." resolves as success');
  console.log('✓ "OK." → success');

  // 4) A genuine rejection must STILL throw (and carry MFL's real message).
  mockBody(JSON.stringify({ error: 'You do not have enough available FAAB dollars.' }));
  let threw = null;
  try {
    await mfl.importRequest('blindBidWaiverRequest', { host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597', PICKS: '1_9999_2' });
  } catch (e) {
    threw = e;
  }
  assert(threw, 'a real error still throws');
  assert(/FAAB/i.test(mfl.errorDetail(threw)), `real error detail is preserved, got "${mfl.errorDetail(threw)}"`);
  console.log('✓ real rejection still throws with MFL detail');

  // 5) A bare 500 with an HTML body is not mistaken for OK.
  mockBody('<html><body>Internal Server Error</body></html>');
  let threw2 = null;
  try {
    await mfl.importRequest('waiverRequest', { host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597', ROUND: 1, PICKS: '1_2' });
  } catch (e) {
    threw2 = e;
  }
  assert(threw2, 'an HTML error body is not treated as OK');
  console.log('✓ HTML error body → still throws');

  console.log('\nIMPORT OK HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
