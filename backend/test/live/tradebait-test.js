'use strict';
// Centralized trade bait ("on the block"): a per-(league,player) store, an
// ownership-guarded add, and a cross-league roll-up grouped by league with value,
// roster slot, note, and stale detection. LIVE mode with stubbed MFL reads.
process.env.MFL_DEMO_MODE = 'false';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'Mine Star, A', position: 'WR', team: 'AAA' },
  { id: '2', name: 'Mine Bench, B', position: 'RB', team: 'BBB' },
  { id: '9', name: 'Not Mine, Z', position: 'TE', team: 'ZZZ' },
];
// My roster in league 1000 holds players 1 and 2 (not 9).
mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Dynasty', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: { starters: { position: [{ name: 'WR', limit: '1' }, { name: 'RB', limit: '1' }] }, franchises: { franchise: [{ id: '0001' }, { id: '0002' }] } } };
    case 'rosters':
      return { rosters: { franchise: [
        { id: '0001', player: [{ id: '1', status: 'starter' }, { id: '2', status: 'nonstarter' }] },
        { id: '0002', player: [{ id: '9', status: 'starter' }] },
      ] } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '1', maybeAge: 25 }, value: 9000, overallRank: 2 },
  { player: { mflId: '2', maybeAge: 24 }, value: 3600, overallRank: 40 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

// Capture the native-MFL Trade Bait sync (import TYPE=tradeBait) so we can assert the
// full block is pushed on every change.
const imports = [];
mfl.importRequest = async (type, params) => { imports.push({ type, params }); return {}; };

const tradebait = require('../../src/services/tradebait');
const store = require('../../src/store/tradebait');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TOK = 'tok-tradebait';
  // Start clean.
  store.remove(TOK, '1000', '1'); store.remove(TOK, '1000', '2'); store.remove(TOK, '1000', '9');

  // Empty to start.
  let block = await tradebait.getBlock(CK, TOK);
  assert(block.totals.count === 0, 'block starts empty');

  // Can't block a player you don't roster.
  let rejected = false;
  try { await tradebait.add(CK, TOK, '1000', '9'); } catch (e) { rejected = e.status === 400 && /roster/.test(e.message); }
  assert(rejected, 'blocking a non-rostered player is rejected');
  console.log('✓ add is ownership-guarded (can only block a player you roster)');

  // Block a player I roster, with a note.
  imports.length = 0;
  const added = await tradebait.add(CK, TOK, '1000', '1', 'Selling high');
  assert(added.ok && added.onBlock, 'add returns onBlock');
  assert(store.has(TOK, '1000', '1'), 'store records the bait');
  assert(JSON.stringify((await tradebait.leagueIds(CK, TOK, '1000')).ids) === JSON.stringify(['1']), 'league ids reflect the block (MFL bait ∪ local)');

  // The add pushed the full block to MFL's native Trade Bait board.
  const push = imports.find((i) => i.type === 'tradeBait');
  console.log('MFL sync:', JSON.stringify(push && { WILL_GIVE_UP: push.params.WILL_GIVE_UP, IN_EXCHANGE_FOR: push.params.IN_EXCHANGE_FOR, L: push.params.L }));
  assert(push && push.params.WILL_GIVE_UP === '1', 'add syncs WILL_GIVE_UP=1 to MFL tradeBait');
  assert(push.params.IN_EXCHANGE_FOR === 'Selling high', 'note carried as IN_EXCHANGE_FOR');
  assert(push.params.L === '1000' && push.params.FRANCHISE === '0001', 'sync targets the right league/franchise');
  assert(added.synced === true, 'add reports synced');
  console.log('✓ sync: putting a player on the block pushes the full set to MFL native Trade Bait');

  // Roll-up shows him with value, slot, note, and suggested partners.
  block = await tradebait.getBlock(CK, TOK);
  assert(block.totals.count === 1 && block.totals.leagues === 1, 'roll-up counts one player in one league');
  const lg = block.leagues[0];
  const p = lg.players[0];
  console.log('block player:', JSON.stringify({ name: p.name, value: p.value, bucket: p.bucket, note: p.note, stale: p.stale, suggestions: p.suggestions }));
  assert(p.id === '1' && p.value === 100 && p.bucket === 'starter' && p.note === 'Selling high' && p.stale === false, 'player resolved with value/slot/note, not stale');
  assert(lg.value === 100, 'league bait value summed');
  // Rival 0002 rosters no WR, so my shopped WR should surface them as a fit.
  assert(Array.isArray(p.suggestions) && p.suggestions.some((s) => s.franchiseId === '0002'), 'suggests the WR-needy rival');
  assert(p.suggestions.every((s) => s.name && s.reason), 'each suggestion has a name and a reason');
  console.log('✓ roll-up: player carries value/slot/note + suggested trade partners —', p.suggestions.map((s) => `${s.name} (${s.reason})`).join(', '));

  // Editing the note (what the in-app note editor does): re-add with a new note —
  // idempotent per league+player, and re-syncs the new IN_EXCHANGE_FOR to MFL.
  imports.length = 0;
  await tradebait.add(CK, TOK, '1000', '1', 'Firm ask: a 1st');
  block = await tradebait.getBlock(CK, TOK);
  assert(block.totals.count === 1, 'no duplicate on re-add');
  assert(block.leagues[0].players[0].note === 'Firm ask: a 1st', 'note updated on re-add');
  const notePush = imports.find((i) => i.type === 'tradeBait');
  assert(notePush && notePush.params.WILL_GIVE_UP === '1' && notePush.params.IN_EXCHANGE_FOR === 'Firm ask: a 1st', 'editing the note re-syncs IN_EXCHANGE_FOR to MFL');
  console.log('✓ note edit updates the note (no duplicate) and re-syncs it to MFL');

  // Remove — clears the bait locally AND re-syncs an empty set to MFL.
  imports.length = 0;
  const removed = await tradebait.remove(CK, TOK, '1000', '1');
  assert(removed.ok && !removed.onBlock && !store.has(TOK, '1000', '1'), 'remove clears the bait');
  const clearPush = imports.find((i) => i.type === 'tradeBait');
  assert(clearPush && clearPush.params.WILL_GIVE_UP === '', 'remove re-syncs an empty block to MFL (clears the board)');
  block = await tradebait.getBlock(CK, TOK);
  assert(block.totals.count === 0, 'block empty after remove');
  console.log('✓ remove takes a player off the block and clears it on MFL');

  console.log('\nTRADE BAIT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
