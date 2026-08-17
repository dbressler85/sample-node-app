'use strict';
// A valid free agent in a DEEP league must be claimable even when he sits past the internal 400-id
// free-agent cap. loadClaimCtx used to validate against freeAgentIds' default top-400 slice, but the
// wizard/best-available seeds an add from the FULL pool sorted by VALUE — so a high-value FA beyond
// export-position 400 (common in 2QB / 24-man-roster leagues) was offered yet rejected on submit as
// "not available in this league". Validation must accept ANY real free agent; a non-FA still fails.
const os = require('os');
const path = require('path');
process.env.DATA_DIR = path.join(os.tmpdir(), `dc-deepfa-${process.pid}-${Date.now()}`);
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const mfl = require('../../src/lib/mfl');

const DEEP_ID = '9000'; // a real FA sitting at export-position 450 (past the 400 cap)
const OFF_ID = '77777'; // a real player who is NOT a free agent here (rostered elsewhere)
// 450 filler FAs, then our deep one last → index 450, beyond the old 400 slice.
const FA_PLAYERS = [...Array.from({ length: 450 }, (_, i) => ({ id: String(1000 + i) })), { id: DEEP_ID }];

const PLAYERS = [
  { id: '1', name: 'My, Starter', position: 'RB', team: 'AAA' },
  { id: '2', name: 'My, Bench', position: 'WR', team: 'BBB' },
  { id: DEEP_ID, name: 'Sleeper, Deep', position: 'RB', team: 'CCC' },
  { id: OFF_ID, name: 'Rostered, Elsewhere', position: 'RB', team: 'DDD' },
];
global.fetch = async () => ({ ok: true, json: async () => [] });
const past = String(Math.floor(Date.now() / 1000) - 86400);

mfl.exportRequest = async (type, opts = {}) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [
        { league_id: 'LFAAB', name: 'Deep FAAB', url: 'https://www10.myfantasyleague.com/2026/home/LFAAB', franchise_id: '0001', franchise_name: 'Me' },
      ] } };
    case 'league':
      return { league: {
        rosterSize: '3', minBid: '1', bbidWaivers: '1',
        franchises: { franchise: [{ id: '0001', name: 'Me', bbidAvailableBalance: '80' }] },
        starters: { position: [{ name: 'RB', limit: '1' }, { name: 'WR', limit: '1' }] },
      } };
    case 'rosters':
      return { rosters: { franchise: [{ id: opts.FRANCHISE || '0001', player: [{ id: '1', status: 'starter' }, { id: '2', status: 'nonstarter' }] }] } };
    case 'freeAgents':
      return { freeAgents: { leagueUnit: { player: FA_PLAYERS } } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'projectedScores':
      return { projectedScores: { playerScore: [] } };
    case 'nflSchedule':
      return { nflSchedule: { week: '3', matchup: [{ team: [{ id: 'CCC' }, { id: 'ZZZ' }] }] } };
    case 'calendar':
      return { calendar: { event: [{ title: 'Allow Add/Drops', start: past }] } }; // open window
    case 'pendingWaivers':
      return { pendingWaivers: {} };
    case 'playerRosterStatus':
      return { playerRosterStatuses: { playerStatus: [{ id: DEEP_ID, is_fa: '1' }] } };
    case 'draftResults':
      return {}; // no draft → free agency open
    default:
      return {};
  }
};
mfl.importRequest = async () => ({ status: 'ok' });

const waivers = require('../../src/services/waivers');
const CK = 'ck', TK = 'tk';
const hasNotAvailable = (p) => (p.errors || []).some((e) => /not available in this league/i.test(e));

(async () => {
  // The deep free agent (index 450, past the old 400 cap) must validate — the exact prod bug where a
  // wizard-offered add came back "Sleeper, Deep is not available in this league."
  const deep = await waivers.preview(CK, TK, 'LFAAB', { addId: DEEP_ID, dropId: '2' });
  assert(!hasNotAvailable(deep), `deep FA must NOT be rejected as unavailable, got ${JSON.stringify(deep.errors)}`);
  assert(deep.valid, `deep FA claim should be valid, got ${JSON.stringify(deep.errors)}`);
  console.log('✓ a valid free agent past the 400-id cap is claimable (no false "not available")');

  // Negative control: a player who is genuinely NOT a free agent here is still rejected — the fix
  // widens the set to the full pool, it does not disable the availability check.
  const off = await waivers.preview(CK, TK, 'LFAAB', { addId: OFF_ID, dropId: '2' });
  assert(hasNotAvailable(off) && !off.valid, `a genuine non-free-agent is still rejected, got ${JSON.stringify(off.errors)}`);
  console.log('✓ a genuine non-free-agent is still rejected as not available (check intact)');

  console.log('\nWAIVER DEEP FREE-AGENT HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
