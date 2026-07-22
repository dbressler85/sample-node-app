'use strict';

// Watchlist → Home alerts: a watched player who becomes a FREE AGENT you could claim,
// or whom another owner puts ON THE BLOCK, surfaces as an alert. Demo data: 16002 is a
// free agent in every league; 15264 is on franchise 0004's trade-bait board in league
// 64097 (my franchise there is 0003).

process.env.MFL_DEMO_MODE = 'true';

const watchlist = require('../../src/services/watchlist');
const watchStore = require('../../src/store/watchlist');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const TOKEN = 'watch-alerts-test-token';
const FA_ID = '16002';       // free agent in all demo leagues
const BAIT_ID = '15264';     // on a rival's block in 64097
const L_BAIT = '64097';

(async () => {
  // Clean slate for this token.
  for (const id of watchStore.list(TOKEN)) watchStore.remove(TOKEN, id);

  // Not watching anything → no alerts, fast path.
  assert((await watchlist.alerts('ck', TOKEN)).alerts.length === 0, 'no watchlist → no alerts');

  watchStore.add(TOKEN, FA_ID);
  watchStore.add(TOKEN, BAIT_ID);

  const { alerts } = await watchlist.alerts('ck', TOKEN);
  console.log('alerts:', JSON.stringify(alerts.map((a) => `${a.type}:${a.playerId}@${a.leagueId}`)));

  const free = alerts.filter((a) => a.type === 'free' && a.playerId === FA_ID);
  const onblock = alerts.filter((a) => a.type === 'onblock' && a.playerId === BAIT_ID);
  assert(free.length >= 1, 'watched free agent surfaces a "free" alert');
  assert(free[0].name && free[0].leagueName, 'alert carries resolved player + league names');
  assert(onblock.some((a) => String(a.leagueId) === L_BAIT), 'watched player on a rival\'s block surfaces an "onblock" alert');

  // Draft-awareness: a player isn't a free agent until the league's draft has been held.
  // 16002 is a free agent in every demo league, but 64097's draft is only 'scheduled' and
  // 40750's is 'in_progress' — the free-agent signal must be suppressed there (only 19622,
  // whose draft is 'complete', is truly open). On-the-block is unaffected (see above).
  const L_DRAFTED = '19622'; // draft complete → FA open
  const L_PREDRAFT = ['64097', '40750']; // scheduled / in_progress → FA not open yet
  assert(free.every((a) => String(a.leagueId) === L_DRAFTED), 'free alerts only from leagues whose draft is complete');
  assert(!alerts.some((a) => a.type === 'free' && L_PREDRAFT.includes(String(a.leagueId))), 'no phantom free-agent alerts from undrafted leagues');
  // Free alerts sort ahead of on-the-block ones.
  assert(alerts[0].type === 'free', 'claimable free agents are ordered first');

  // The Watch-tab roll-up (getWatchlist) draws the same draft distinction per league: a
  // watched, unrostered player is "free" only where the draft is complete (19622), and
  // "draftable" where it hasn't run / is mid-way (64097 scheduled, 40750 in_progress).
  const wl = await watchlist.getWatchlist('ck', TOKEN);
  const fa = wl.players.find((p) => p.id === FA_ID); // free agent in every demo league
  console.log('roll-up 16002 summary:', JSON.stringify(fa.summary), 'leagues:', JSON.stringify(fa.leagues.map((l) => `${l.leagueId}:${l.relation}`)));
  assert(fa.summary.free === 1, 'free only in the drafted league (19622)');
  assert(fa.summary.draftable === 2, 'draftable in the two undrafted leagues (64097, 40750)');
  assert(fa.leagues.find((l) => String(l.leagueId) === L_DRAFTED).relation === 'free', 'drafted league → free');
  assert(L_PREDRAFT.every((id) => fa.leagues.find((l) => String(l.leagueId) === id).relation === 'draftable'), 'undrafted leagues → draftable');
  console.log('✓ watchlist roll-up: free vs draftable split by draft status');

  // Cleanup.
  for (const id of watchStore.list(TOKEN)) watchStore.remove(TOKEN, id);

  console.log('✓ watchlist alerts: free-agent + on-the-block signals, name-resolved');
  console.log('\nWATCHLIST ALERTS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
