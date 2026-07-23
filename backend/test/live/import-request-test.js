'use strict';
// mfl.importRequest wire format: MFL reads import params from the QUERY STRING (only a DATA
// payload goes in the POST body). Putting L/PICKS/ROUND in the body made MFL 500 — this pins the
// query placement so that can't regress.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

let captured = null;
global.fetch = async (url, init) => {
  captured = { url: String(url), init };
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ status: 'ok' }) };
};

(async () => {
  // 1) Non-DATA import (a waiver claim): every param in the query, no DATA body.
  await mfl.importRequest('blindBidWaiverRequest', { host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597', PICKS: '17510_1_14849', ROUND: 1 });
  const u = captured.url;
  assert(/\/import\?/.test(u), 'hits the import command');
  assert(u.includes('TYPE=blindBidWaiverRequest'), 'TYPE in the query');
  assert(u.includes('L=69597'), 'L in the query (not the body)');
  assert(u.includes('PICKS=17510_1_14849'), `PICKS in the query, got ${u}`);
  assert(u.includes('ROUND=1'), 'ROUND in the query');
  assert(u.includes('JSON=1'), 'JSON=1 present');
  assert(captured.init.method === 'POST', 'still a POST');
  assert(!captured.init.body, 'no request body for a non-DATA import');
  assert(!/host=|cookie=/i.test(u), 'host/cookie are not query params');
  console.log('✓ non-DATA import: L/PICKS/ROUND all in the query string, no body');

  // 2) DATA import (bulk XML): DATA in the body, other params still in the query.
  await mfl.importRequest('auctionResults', { host: 'www45.myfantasyleague.com', cookie: 'ck', L: '69597', DATA: '<auctionResults/>' });
  const u2 = captured.url;
  assert(u2.includes('TYPE=auctionResults') && u2.includes('L=69597'), 'DATA import: TYPE + L in the query');
  assert(!u2.includes('DATA='), 'DATA is NOT in the query');
  assert(captured.init.body && captured.init.body.includes('DATA='), 'DATA is form-encoded in the body');
  console.log('✓ DATA import: params in the query, DATA in the body');

  console.log('\nIMPORT REQUEST HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
