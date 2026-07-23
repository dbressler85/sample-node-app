'use strict';
// When MFL REJECTS a trade write (accept/reject or propose), the app must surface MFL's real
// reason — not a bare status (hard-won rule). This stubs importRequest to reject with an mflError
// and asserts respond()/propose() bubble that detail up (message + err.detail). The happy "OK"
// path is covered generically by import-ok-test (both writes go through importRequest).
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

// Reads the service needs to resolve a league / build a proposal. Minimal but valid.
mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Detail League', url: 'https://www49.myfantasyleague.com/2026/home/1000', franchise_id: '0001' }] } };
    case 'league':
      return { league: { franchises: { franchise: [{ id: '0001' }, { id: '0002' }] }, starters: { position: [{ name: 'QB', limit: '1' }] } } };
    case 'players':
      return { players: { player: [{ id: '1', name: 'Giver, Guy', position: 'RB', team: 'AAA' }, { id: '20', name: 'Target, Tom', position: 'WR', team: 'BBB' }] } };
    default:
      return {};
  }
};

// The write always rejects with MFL's own message (as rawRequest would set it).
let lastImport = null;
mfl.importRequest = async (type, params) => {
  lastImport = { type, params };
  const err = new Error('MFL API error: Trade is no longer valid');
  err.mflError = 'Trade is no longer valid';
  throw err;
};

const trades = require('../../src/services/trades');
const CK = 'ck';
const TK = 'tk';

(async () => {
  // Accept a trade that MFL rejects -> the real reason surfaces (message + err.detail).
  let caught = null;
  try {
    await trades.respond(CK, TK, '1000', 'TR9', 'accept');
  } catch (e) {
    caught = e;
  }
  assert(caught, 'respond throws when MFL rejects');
  assert(/Trade is no longer valid/.test(caught.message), `respond surfaces MFL detail, got "${caught.message}"`);
  assert(caught.detail === 'Trade is no longer valid', 'respond sets err.detail to MFL reason');
  assert(lastImport.type === 'tradeResponse' && lastImport.params.TRADE_ID === 'TR9', 'respond still targeted tradeResponse with the right id');
  console.log('✓ respond: MFL rejection reason surfaces (message + err.detail)');

  // Propose a trade that MFL rejects -> same treatment.
  caught = null;
  try {
    await trades.propose(CK, TK, '1000', { toFranchiseId: '0002', give: ['1'], receive: ['20'] });
  } catch (e) {
    caught = e;
  }
  assert(caught, 'propose throws when MFL rejects');
  assert(/Trade is no longer valid/.test(caught.message), `propose surfaces MFL detail, got "${caught.message}"`);
  assert(caught.detail === 'Trade is no longer valid', 'propose sets err.detail to MFL reason');
  assert(lastImport.type === 'tradeProposal' && lastImport.params.OFFEREDTO === '0002', 'propose still targeted tradeProposal to the right team');
  console.log('✓ propose: MFL rejection reason surfaces (message + err.detail)');

  console.log('\nTRADE WRITE DETAIL HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
