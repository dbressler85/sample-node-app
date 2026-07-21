'use strict';
// Regression for the "trade offers are impossible to understand" report:
//   1. MFL's upcoming-draft pick tokens are DP_<round>_<pick>, ZERO-based on BOTH
//      fields — DP_0_10 is round 1 pick 11 ("1.11"), DP_2_2 is round 3 pick 3
//      ("3.03"). We used to render them as the raw token ("Player DP_0_10").
//   2. MFL returns the received-assets field as snake_case `will_receive` on the
//      pendingTrades export; the parser only checked camelCase, so what YOU give
//      up came back empty ("You give · 0"). attr() now matches any casing.
// This reproduces the exact picks-for-picks offer from the bug report.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');
const picks = require('../../src/lib/picks');

// Ground truth from the MFL website screenshot (Rabid Koalas = 0001):
//   Phintastic (0002) gives up  1.11 (DP_0_10) + 3.03 (DP_2_2)   -> I RECEIVE
//   I give in return            2.02 (DP_1_1)  + 2.04 (DP_1_3)    -> I SEND
mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'FLEX DEVIANT', url: 'https://www49.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'Rabid Koalas' }] } };
    case 'players':
      return { players: { player: [{ id: '1', name: 'Filler, One', position: 'RB', team: 'AAA' }] } };
    case 'league':
      return { league: {
        starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '2' }, { name: 'WR', limit: '2' }] },
        franchises: { franchise: [{ id: '0001', name: 'Rabid Koalas' }, { id: '0002', name: 'Phintastic Voyage III' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: [{ id: '1', status: 'starter' }] }, { id: '0002', player: [] }] } };
    case 'pendingTrades':
      // snake_case fields exactly as MFL returns them — the receive side used to be dropped.
      return { pendingTrades: { pendingTrade: [
        { trade_id: 'TR1', offeringteam: '0002', offeredto: '0001', will_give_up: 'DP_0_10,DP_2_2', will_receive: 'DP_1_1,DP_1_3' },
      ] } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    default:
      return {};
  }
};
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? [] : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // --- unit: token decode is zero-based on both round and pick ---
  assert(picks.labelForToken('DP_0_10') === '2026 1.11', 'DP_0_10 -> 2026 1.11');
  assert(picks.labelForToken('DP_2_2') === '2026 3.03', 'DP_2_2 -> 2026 3.03');
  assert(picks.labelForToken('DP_1_1') === '2026 2.02', 'DP_1_1 -> 2026 2.02');
  assert(picks.labelForToken('FP_0003_2027_1') === '2027 1st', 'FP token still decodes');
  console.log('✓ DP/FP tokens decode to readable slots (DP is zero-based on round AND pick)');

  // --- unit: attr() reads MFL's inconsistent field casing ---
  const tr = { offeredto: '0001', will_give_up: 'a,b', will_receive: 'c,d' };
  assert(mfl.attr(tr, 'willreceive', 'willreceiveinreturn') === 'c,d', 'attr reads snake_case will_receive');
  assert(mfl.attr({ willReceiveInReturn: 'x' }, 'willreceive', 'willreceiveinreturn') === 'x', 'attr still reads camelCase');
  console.log('✓ attr() reads will_receive (snake) and willReceiveInReturn (camel) alike');

  // --- end to end: the exact offer from the screenshot ---
  const lg = await trades.getLeague('ck', 'tok', '1000');
  const offer = lg.offers.find((o) => o.id === 'TR1');
  assert(offer, 'the incoming offer is present');

  const names = (arr) => arr.map((a) => a.name);
  assert(offer.acquire.length === 2, 'I receive two assets');
  assert(offer.send.length === 2, 'I give two assets (was empty — the bug)');
  console.log('You get: ', names(offer.acquire).join(' + '));
  console.log('You give:', names(offer.send).join(' + '));

  assert(names(offer.acquire).join(',') === '2026 1.11,2026 3.03', 'received picks read as 1.11 + 3.03');
  assert(names(offer.send).join(',') === '2026 2.02,2026 2.04', 'given picks read as 2.02 + 2.04');
  assert(offer.acquire.every((a) => a.kind === 'pick' && a.value > 0), 'received picks are valued');
  assert(offer.send.every((a) => a.kind === 'pick' && a.value > 0), 'given picks are valued');

  // A round-1 + round-3 haul should out-value two round-2s, so the deal reads favorable to me.
  assert(offer.analysis.sendValue > 0, 'You give is no longer 0');
  assert(offer.analysis.acquireValue > offer.analysis.sendValue, '1st+3rd out-values two 2nds');
  console.log(`✓ end to end: net ${offer.analysis.net > 0 ? '+' : ''}${offer.analysis.net} (get ${offer.analysis.acquireValue} / give ${offer.analysis.sendValue})`);

  console.log('\nPICK TOKEN HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
