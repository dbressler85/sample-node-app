'use strict';
// LIVE standings column parsing, pinned to a real leagueStandings?COLUMN_NAMES=1 sample.
// Confirms the core field ids (h2hw/h2hl/h2ht/pf/pa) AND the richer columns we now surface
// (strk, all_play_pct, h2hpct, pp). Read defensively: '-'/'' → null, never an error.
process.env.MFL_DEMO_MODE = 'false';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '69597', name: 'Dynasty', url: 'https://www45.myfantasyleague.com/2026/home/69597', franchise_id: '0001', franchise_name: 'Me' }] } };
    case 'leagueStandings':
      // Shape lifted from the real export (subset of columns).
      return { leagueStandings: { franchise: [
        { id: '0001', h2hwlt: '2-1-0', h2hw: '2', h2hl: '1', h2ht: '0', pf: '250.5', pa: '200.0', strk: 'W2', all_play_pct: '.667', h2hpct: '.667', pp: '275', bbidbalance: '$900.00' },
        { id: '0002', h2hwlt: '1-2-0', h2hw: '1', h2hl: '2', h2ht: '0', pf: '210.0', pa: '240.0', strk: '-', all_play_pct: '.333', h2hpct: '.333', pp: '260', bbidbalance: '$1000.00' },
      ] } };
    case 'league':
      return { league: { playoffTeams: '6', franchises: { franchise: [{ id: '0001', name: 'Me' }, { id: '0002', name: 'Rival' }] } } };
    default:
      return {};
  }
};
global.fetch = async () => ({ ok: true, json: async () => [] });

const league = require('../../src/services/league');

(async () => {
  const out = await league.getStandings('ck', '69597');
  const me = out.standings.find((s) => s.franchiseId === '0001');
  const other = out.standings.find((s) => s.franchiseId === '0002');

  // Core fields (confirmed correct against the sample).
  assert(me.wins === 2 && me.losses === 1 && me.record === '2-1', `core record parsed, got ${me.record}`);
  assert(me.pointsFor === 250.5 && me.pointsAgainst === 200, 'pf/pa parsed');

  // New columns.
  assert(me.streak === 'W2', `streak parsed, got ${me.streak}`);
  assert(me.allPlayPct === 0.667, `all-play pct parsed, got ${me.allPlayPct}`);
  assert(me.winPct === 0.667, `win pct parsed, got ${me.winPct}`);
  assert(me.potentialPoints === 275, `potential points parsed, got ${me.potentialPoints}`);
  // A '-' streak (no active streak) becomes null, not the literal dash.
  assert(other.streak === null, `'-' streak → null, got ${other.streak}`);
  console.log('✓ standings: core ids confirmed + streak/all-play/win%/PP surfaced');

  console.log('\nSTANDINGS COLUMNS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
