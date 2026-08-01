'use strict';
// Pick Capital ACQUIRE, two-sided: when I pay a win-now team for their pick, the player I send must come
// from a position I can SPARE — not one I'm already thin at. Regression for the dead
// `theirNeeds.includes(p.position)` check (it compared {pos} objects to a string, so ANY player could be
// shipped, including my only WR) plus the new surplus-first rank: spend from a SURPLUS spot, avoid a NEED.
//
// Fixture: I (0001) run four solid RBs (a clear RB surplus) but only ONE WR — a high-value STUD, so WR is
// a need (I lack a 2nd body) AND my single most valuable player. The win-now partner (0002) also needs WR
// and holds a pick. A value-desc packer would ship the WR stud first (highest value) and gut my WR room;
// the fixed surplus-first packer sends the lower-value-but-spare RBs instead. The high-value WR is what
// makes this test actually distinguish the fix from the old dead-check behavior.
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_SEASON = '2026';
delete process.env.MFL_WEEK;

const mfl = require('../../src/lib/mfl');

const PLAYERS = [
  { id: '1', name: 'My RB1', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My RB2', position: 'RB', team: 'BBB' },
  { id: '3', name: 'My RB3', position: 'RB', team: 'CCC' },
  { id: '4', name: 'My RB4', position: 'RB', team: 'DDD' },
  { id: '5', name: 'My WR', position: 'WR', team: 'EEE' },
  { id: '6', name: 'My QB', position: 'QB', team: 'FFF' },
  { id: '7', name: 'My TE', position: 'TE', team: 'GGG' },
  { id: '10', name: 'Win QB', position: 'QB', team: 'HHH' },
  { id: '11', name: 'Win RB1', position: 'RB', team: 'III' },
  { id: '12', name: 'Win RB2', position: 'RB', team: 'JJJ' },
  { id: '13', name: 'Win TE', position: 'TE', team: 'KKK' },
  { id: '14', name: 'Win WR', position: 'WR', team: 'LLL' },
  { id: '20', name: 'Reb QB', position: 'QB', team: 'MMM' },
  { id: '21', name: 'Reb RB', position: 'RB', team: 'NNN' },
  { id: '22', name: 'Reb WR', position: 'WR', team: 'OOO' },
  { id: '23', name: 'Reb TE', position: 'TE', team: 'PPP' },
];
const ROSTERS = {
  '0001': ['1', '2', '3', '4', '5', '6', '7'], // 4 RBs (surplus), 1 WR (need)
  '0002': ['10', '11', '12', '13', '14'], //      win-now, thin at WR (their need), holds a pick
  '0003': ['20', '21', '22', '23'], //            rebuilding, no picks
};
const ASSETS = [
  { id: '0001', futureYearDraftPicks: { draftPick: [] } },
  { id: '0002', futureYearDraftPicks: { draftPick: [{ pick: 'FP_0002_2027_1', description: '' }] } },
  { id: '0003', futureYearDraftPicks: { draftPick: [] } },
];

mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Surplus League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'league':
      return { league: {
        starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '2' }, { name: 'WR', limit: '2' }, { name: 'TE', limit: '1' }] },
        franchises: { franchise: [{ id: '0001', name: 'My Team' }, { id: '0002', name: 'Contenders' }, { id: '0003', name: 'Rebuild Crew' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: Object.entries(ROSTERS).map(([id, ids]) => ({ id, player: ids.map((pid) => ({ id: pid, status: 'starter' })) })) } };
    case 'assets':
      return { assets: { franchise: ASSETS } };
    case 'injuries':
      return { injuries: { injury: [] } };
    case 'pendingTrades':
      return {};
    default:
      return {};
  }
};

// value (÷100 = display) + age. My RB room is deep (surplus, but each RB is modest); my lone WR is a
// high-value stud AND a need (only 1 body for 2 slots) — the value-desc trap the fix has to avoid.
const FC = [
  { player: { mflId: '1', maybeAge: 25 }, value: 6000, overallRank: 15 }, // 60 RB (surplus)
  { player: { mflId: '2', maybeAge: 24 }, value: 5800, overallRank: 17 }, // 58 RB
  { player: { mflId: '3', maybeAge: 26 }, value: 5500, overallRank: 20 }, // 55 RB
  { player: { mflId: '4', maybeAge: 25 }, value: 5000, overallRank: 30 }, // 50 RB
  { player: { mflId: '5', maybeAge: 24 }, value: 8000, overallRank: 6 },  // 80 lone WR STUD (a need)
  { player: { mflId: '6', maybeAge: 26 }, value: 5200, overallRank: 28 }, // 52 QB
  { player: { mflId: '7', maybeAge: 25 }, value: 4500, overallRank: 40 }, // 45 TE
  { player: { mflId: '10', maybeAge: 30 }, value: 9000, overallRank: 3 }, // 90 old core → win-now
  { player: { mflId: '11', maybeAge: 29 }, value: 8500, overallRank: 5 }, // 85
  { player: { mflId: '12', maybeAge: 28 }, value: 8000, overallRank: 7 }, // 80
  { player: { mflId: '13', maybeAge: 29 }, value: 7000, overallRank: 9 }, // 70
  { player: { mflId: '14', maybeAge: 27 }, value: 2000, overallRank: 70 }, // 20 their thin WR (need)
  { player: { mflId: '20', maybeAge: 22 }, value: 2000, overallRank: 72 }, // 20
  { player: { mflId: '21', maybeAge: 21 }, value: 1500, overallRank: 85 }, // 15
  { player: { mflId: '22', maybeAge: 22 }, value: 1200, overallRank: 90 }, // 12
  { player: { mflId: '23', maybeAge: 21 }, value: 1000, overallRank: 95 }, // 10
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const trades = require('../../src/services/trades');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const acq = await trades.pickPartners('ck', 'tok', '1000', 'acquire');
  const win = acq.partners.find((p) => p.franchiseId === '0002');
  assert(win, 'the win-now pick-holder is an acquire target');
  const sent = win.deal.send.map((a) => a.name).join('+');
  console.log(`acquire vs 0002: receive ${win.deal.receive.map((a) => a.name).join('+')} for ${sent}`);

  // The core assertion: I pay with a SURPLUS RB, never my lone WR (a position I need), even though
  // the WR would fill THEIR need. Two-sided discipline beats a naive their-need fill.
  const sendPositions = win.deal.send.map((a) => a.position);
  assert(win.deal.send.every((a) => a.kind === 'player'), 'I send player(s), not picks');
  assert(!win.deal.send.some((a) => a.id === '5'), `my lone WR (a need) is NOT sent, got ${sent}`);
  assert(sendPositions.every((pos) => pos !== 'WR'), `no player from my WR need is sent, got ${sendPositions.join(',')}`);
  assert(sendPositions.includes('RB'), `I spend from my RB surplus, got ${sendPositions.join(',')}`);
  console.log('✓ acquire pays from RB surplus, protects the thin WR (their need ≠ my scarcity)');

  console.log('\nPICK PARTNERS SURPLUS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
