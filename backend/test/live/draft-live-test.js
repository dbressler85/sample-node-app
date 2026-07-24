'use strict';
// Stubbed LIVE-mode harness for drafts: draftResults -> board/order/on-clock,
// freeAgents -> value-ranked pool, and makePick -> MFL Misc `live_draft` (CMD=DRAFT).
process.env.MFL_DEMO_MODE = 'false';
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-draftlive-${process.pid}-${Date.now()}`);

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '20', name: 'Drafted, Guy', position: 'WR', team: 'AAA' },
  { id: '30', name: 'Best, Available', position: 'RB', team: 'BBB' },
  { id: '31', name: 'Next, Best', position: 'WR', team: 'CCC' },
];
const imported = [];
mfl.importRequest = async (type, params) => { imported.push({ type, params }); return { status: 'ok' }; };

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Dynasty', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] } } };
    case 'draftResults':
      return { draftResults: { draftUnit: [{ unit: 'LEAGUE', startTime: '1754000000', draftPick: [
        { round: '1', pick: '1', franchise: '0002', player: '20' },
        { round: '1', pick: '2', franchise: '0001', player: '' }, // me — on the clock
        { round: '2', pick: '1', franchise: '0001', player: '' },
        { round: '2', pick: '2', franchise: '0002', player: '' },
      ] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: [{ id: '30' }, { id: '31' }, { id: '20' }] } } };
    case 'myDraftList':
      // Real shape: { myDraftList: { player: [{ id, order }] } }. Deliberately OUT of array order
      // to prove we sort by the `order` field (0-based rank), not the array order.
      return { myDraftList: { player: [{ id: '31', order: '1' }, { id: '30', order: '0' }, { id: '20', order: '2' }] } };
    default:
      return {};
  }
};
const FC = [
  { player: { mflId: '30', sleeperId: 's30', maybeAge: 22 }, value: 9000, overallRank: 1 },
  { player: { mflId: '31', sleeperId: 's31', maybeAge: 23 }, value: 7000, overallRank: 5 },
  { player: { mflId: '20', sleeperId: 's20', maybeAge: 24 }, value: 9500, overallRank: 1 },
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const draft = require('../../src/services/draft');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const CK = 'ck', TK = 'tk';

  const ov = await draft.getOverview(CK, TK);
  console.log('overview:', JSON.stringify(ov));
  const d = ov.drafts[0];
  assert(d.status === 'in_progress', `live draft in progress, got ${d.status}`);
  assert(d.myOnClock === true, 'I am on the clock');
  assert(ov.summary.onClock === 1, 'overview counts my on-clock draft');
  // myNextPick carries round + pick-in-round (for "4.05" notation) AND overall
  // (for "41st overall"), so the UI never shows round.overall as if it were a slot.
  assert(d.myNextPick && d.myNextPick.round === 1 && d.myNextPick.pick === 2 && d.myNextPick.overall === 2,
    `myNextPick has round/pick/overall, got ${JSON.stringify(d.myNextPick)}`);
  console.log('✓ overview: draftResults parsed -> in_progress, on my clock; next pick 1.02 (2nd overall)');

  const dl = await draft.getLeague(CK, TK, '1000');
  console.log('league:', JSON.stringify({ status: dl.status, onClock: dl.onClock, avail: dl.available.map((p) => `${p.name.split(',')[0]}:${p.value}`), board: dl.board.map((s) => `${s.round}.${s.pick}=${s.player ? s.player.name.split(',')[0] : '—'}`) }));
  assert(dl.onClock && dl.onClock.mine && dl.onClock.round === 1 && dl.onClock.pick === 2, 'on the clock at my slot 1.02');
  assert(dl.board.filter((s) => s.player).length === 1 && dl.board.filter((s) => !s.playerId).length === 3, 'board: 1 made + 3 upcoming');
  assert(dl.available[0].id === '30' && dl.available[0].value === 95, 'pool ranked by dynasty value (Best Available on top)');
  assert(!dl.available.some((p) => p.id === '20'), 'already-drafted player excluded from pool');
  console.log('✓ league board + value-ranked available pool');

  // The My Draft List seeds from MFL's `myDraftList` export on first open, ranked by the `order`
  // field (not array order); a listed player already off the board is flagged drafted.
  const dlist = await draft.getDraftList(CK, TK, '1000');
  assert(dlist.list.map((p) => p.id).join(',') === '30,31,20', `draft list seeded in MFL order, got ${dlist.list.map((p) => p.id)}`);
  assert(dlist.list[0].id === '30' && dlist.list[0].rank === 1, 'order=0 ranks first');
  assert(dlist.list.find((p) => p.id === '20').drafted === true, 'a listed player already drafted is flagged');
  console.log('✓ getDraftList seeds from myDraftList export, ordered by `order`');

  // Live drafting IS supported via MFL's Misc `live_draft` command (CMD=DRAFT) — confirmed against
  // the Misc API reference. makePick must fire live_draft (NOT an import) with ROUND/PICK matching
  // the on-clock slot, then reflect the pick on the board.
  const drafted = [];
  mfl.miscRequest = async (command, params) => { drafted.push({ command, params }); return { status: 'OK' }; };
  const after = await draft.makePick(CK, TK, '1000', '30', '  Best value on the board  ');
  assert(drafted.length === 1 && drafted[0].command === 'live_draft', 'makePick fires the live_draft Misc command');
  const pk = drafted[0].params;
  assert(pk.CMD === 'DRAFT' && String(pk.PLAYER_PICK) === '30' && Number(pk.ROUND) === 1 && Number(pk.PICK) === 2,
    `live_draft carries CMD=DRAFT + PLAYER_PICK + on-clock ROUND/PICK, got ${JSON.stringify(pk)}`);
  assert(pk.COMMENTS === 'Best value on the board', `the optional pick comment is trimmed and passed through, got ${JSON.stringify(pk.COMMENTS)}`);
  assert(!imported.some((c) => c.type === 'draftPick'), 'no bogus draftPick import is ever sent to MFL');
  assert(after.board.find((s) => s.round === 1 && s.pick === 2 && s.player && String(s.player.id) === '30'),
    'the just-made pick is reflected on the board (optimistic overlay)');
  console.log('✓ make pick: fires live_draft (CMD=DRAFT), reflects the pick, no import');

  console.log('\nLIVE DRAFT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
