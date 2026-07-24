'use strict';
// tradeResponse RESPONSE has three values (#94): accept/reject (target of an incoming offer) and
// revoke (originator withdrawing an outgoing offer). COMMENTS is an optional note MFL delivers to
// the originator ONLY on a reject. Pins the exact params for each, and that COMMENTS is omitted
// except on reject.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Revoke League', url: 'https://www49.myfantasyleague.com/2026/home/1000', franchise_id: '0001' }] } };
    case 'league':
      return { league: { franchises: { franchise: [{ id: '0001' }, { id: '0002' }] }, starters: { position: [{ name: 'QB', limit: '1' }] } } };
    default:
      return {};
  }
};

let lastImport = null;
mfl.importRequest = async (type, params) => { lastImport = { type, params }; return { status: 'OK' }; };

const trades = require('../../src/services/trades');
const CK = 'ck', TK = 'tk';

(async () => {
  // 1) Revoke → RESPONSE=revoke, targeted trade id, NO comments (MFL ignores a note here).
  lastImport = null;
  const rv = await trades.respond(CK, TK, '1000', 'TR9', 'revoke');
  assert(lastImport.type === 'tradeResponse', 'revoke goes through tradeResponse');
  assert(lastImport.params.RESPONSE === 'revoke', `RESPONSE=revoke, got ${lastImport.params.RESPONSE}`);
  assert(lastImport.params.TRADE_ID === 'TR9', 'targets the right trade id');
  assert(lastImport.params.COMMENTS === undefined, 'no COMMENTS on revoke');
  assert(rv.action === 'revoke' && rv.ok, 'returns the revoke action');
  console.log('✓ revoke: RESPONSE=revoke, right trade id, no COMMENTS');

  // 2) Reject WITH a note → RESPONSE=reject + COMMENTS delivered to the originator.
  lastImport = null;
  await trades.respond(CK, TK, '1000', 'TR9', 'reject', 'No thanks — need a WR back.');
  assert(lastImport.params.RESPONSE === 'reject', 'RESPONSE=reject');
  assert(lastImport.params.COMMENTS === 'No thanks — need a WR back.', `COMMENTS passed through, got ${JSON.stringify(lastImport.params.COMMENTS)}`);
  console.log('✓ reject with note: RESPONSE=reject + COMMENTS');

  // 3) Reject WITHOUT a note → RESPONSE=reject, COMMENTS omitted (not an empty string).
  lastImport = null;
  await trades.respond(CK, TK, '1000', 'TR9', 'reject');
  assert(lastImport.params.RESPONSE === 'reject' && lastImport.params.COMMENTS === undefined, 'reject without a note omits COMMENTS');
  console.log('✓ reject without note: COMMENTS omitted');

  // 4) Accept ignores any note (MFL only delivers COMMENTS on reject).
  lastImport = null;
  await trades.respond(CK, TK, '1000', 'TR9', 'accept', 'should be dropped');
  assert(lastImport.params.RESPONSE === 'accept' && lastImport.params.COMMENTS === undefined, 'accept never sends COMMENTS');
  console.log('✓ accept: COMMENTS never sent');

  // 5) A blank trade id is refused before any write (never target the wrong pending trade).
  let blocked = false;
  lastImport = null;
  try { await trades.respond(CK, TK, '1000', '', 'revoke'); }
  catch (e) { blocked = e.status === 400; }
  assert(blocked && lastImport === null, 'blank trade id → 400, no write');
  console.log('✓ blank trade id: 400, no write fired');

  console.log('\nTRADE REVOKE HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
