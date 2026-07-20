'use strict';

// Watchlist → Home alerts: a watched player who becomes a FREE AGENT you could claim,
// or whom another owner puts ON THE BLOCK, surfaces as an alert. Muted leagues are
// skipped. Demo data: 16002 is a free agent in every league; 15264 is on franchise
// 0004's trade-bait board in league 64097 (my franchise there is 0003).

process.env.MFL_DEMO_MODE = 'true';

const watchlist = require('../../src/services/watchlist');
const leaguePrefs = require('../../src/store/leaguePrefs');
const watchStore = require('../../src/store/watchlist');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

const TOKEN = 'watch-alerts-test-token';
const FA_ID = '16002';       // free agent in all demo leagues
const BAIT_ID = '15264';     // on a rival's block in 64097
const L_BAIT = '64097';

(async () => {
  // Clean slate for this token.
  for (const id of watchStore.list(TOKEN)) watchStore.remove(TOKEN, id);
  leaguePrefs.setMute(TOKEN, L_BAIT, false);

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
  // Free alerts sort ahead of on-the-block ones.
  assert(alerts[0].type === 'free', 'claimable free agents are ordered first');

  // Mute the bait league → its alerts drop out.
  leaguePrefs.setMute(TOKEN, L_BAIT, true);
  const after = (await watchlist.alerts('ck', TOKEN)).alerts;
  assert(!after.some((a) => String(a.leagueId) === L_BAIT), 'muted league produces no alerts');
  assert(after.some((a) => a.type === 'free'), 'free alerts from other (unmuted) leagues remain');

  // Cleanup.
  leaguePrefs.setMute(TOKEN, L_BAIT, false);
  for (const id of watchStore.list(TOKEN)) watchStore.remove(TOKEN, id);

  console.log('✓ watchlist alerts: free-agent + on-the-block signals, name-resolved, mute-aware');
  console.log('\nWATCHLIST ALERTS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
