'use strict';
// Playoff-bracket service. MFL's `playoffBrackets` export is DEFINITIONS ONLY (name/startWeek/
// teamsInvolved/bracketWinnerTitle) — the games live in the `schedule` export. So the service
// COMPOSES the two and reconstructs rounds→games→champion by tracing advancement. This is pinned
// against the REAL completed 2025 bracket for league 69597 (champion = franchise 0011). Demo returns
// a hand-built fixture.

const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  // --- DEMO ---------------------------------------------------------------------------------------
  process.env.MFL_DEMO_MODE = 'true';
  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/services/playoffs')];
  const playoffsDemo = require('../../src/services/playoffs');
  const demo = require('../../src/demo/fixtures');
  const d = await playoffsDemo.getBrackets('ck', demo.leagues()[0].leagueId);
  assert(d.available && d.brackets.length >= 1, 'demo has a bracket');
  assert(d.brackets[0].rounds.length === 3 && d.brackets[0].rounds[2].title === 'Championship', 'demo: 3 rounds ending in Championship');
  assert(d.champion && d.champion.franchiseId, 'demo surfaces a champion');
  console.log('✓ demo: 3-round bracket + champion');

  // --- LIVE: reconstruct the REAL 2025 bracket from playoffBrackets + schedule --------------------
  process.env.MFL_DEMO_MODE = 'false';
  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/services/playoffs')];
  const mflRepo = require('../../src/lib/mflRepo');
  const leaguesService = require('../../src/services/leagues');
  leaguesService.listLeagues = async () => [{ leagueId: '69597', name: 'Real League', host: 'www45.myfantasyleague.com', franchiseId: '0011' }];
  leaguesService.franchiseNames = async () =>
    new Map([['0003', 'Team 3'], ['0005', 'Team 5'], ['0008', 'Team 8'], ['0009', 'Team 9'], ['0010', 'Team 10'], ['0011', 'My Team']]);

  const playoffs = require('../../src/services/playoffs');

  // The actual playoffBrackets metadata the owner's export returned.
  mflRepo.playoffBrackets = async () => [
    { bracketWinnerTitle: 'League Champion', startWeek: '15', id: '1', teamsInvolved: '6', startWeekGames: '2', name: 'Playoff Bracket' },
    { startWeekGames: '1', teamsInvolved: '2', startWeek: '17', id: '2', bracketWinnerTitle: '3rd Place', name: '3rd Place Game' },
  ];
  // The actual playoff-week matchups from the schedule export (weeks 15/16/17 only — the rest of the
  // season isn't needed to reconstruct the bracket).
  const g = (aId, aScore, aRes, bId, bScore, bRes) => ({ franchise: [{ id: aId, score: aScore, result: aRes }, { id: bId, score: bScore, result: bRes }] });
  mflRepo.schedule = async () => [
    { week: '15', matchup: [g('0011', '155.76', 'W', '0003', '132.26', 'L'), g('0005', '206.12', 'W', '0010', '170.78', 'L')] },
    { week: '16', matchup: [g('0011', '174.98', 'W', '0009', '148.2', 'L'), g('0005', '115.68', 'L', '0008', '132.98', 'W')] },
    { week: '17', matchup: [g('0011', '207.1', 'W', '0008', '84.28', 'L'), g('0009', '154.74', 'W', '0005', '118.06', 'L')] },
  ];

  const L = await playoffs.getBrackets('ck', '69597');
  assert(L.available, 'live bracket available');
  // Champion = the undefeated team (0011), surfaced with its name + title.
  assert(L.champion && L.champion.franchiseId === '0011' && L.champion.name === 'My Team', `champion is 0011: ${JSON.stringify(L.champion)}`);
  assert(/champion/i.test(L.champion.title), `champion title names it: ${L.champion.title}`);
  console.log('✓ live: champion correctly reconstructed as 0011 (the undefeated team)');

  const champBracket = L.brackets[0];
  assert(champBracket.rounds.length === 3, `championship bracket has 3 rounds, got ${champBracket.rounds.length}`);
  assert(champBracket.rounds.map((r) => r.title).join(',') === 'Quarterfinals,Semifinals,Championship', `round titles: ${champBracket.rounds.map((r) => r.title)}`);
  assert(champBracket.rounds[0].week === 15 && champBracket.rounds[2].week === 17, 'rounds carry their weeks');
  // The championship game is the week-17 game between the two undefeated teams (0011 vs 0008), NOT
  // the 3rd-place game (0009 vs 0005).
  const finalGame = champBracket.rounds[2].games[0];
  const finalIds = [finalGame.home.franchiseId, finalGame.away.franchiseId].sort();
  assert(finalIds.join() === '0008,0011', `championship final is 0011 vs 0008, got ${finalIds}`);
  assert(finalGame.winnerFranchiseId === '0011' && finalGame.status === 'final', 'final: 0011 wins, status final');
  assert(finalGame.mine === true, 'my team (0011) flagged on the final');
  assert(finalGame.home.points === 207.1 || finalGame.away.points === 207.1, 'final carries scores');
  console.log('✓ live: championship final correctly separated from the 3rd-place game');

  // The 3rd-place game (0009 def 0005) lands in a second bracket, not the championship path.
  assert(L.brackets.length === 2, `two brackets (championship + 3rd place), got ${L.brackets.length}`);
  const third = L.brackets[1];
  const thirdIds = [third.rounds[0].games[0].home.franchiseId, third.rounds[0].games[0].away.franchiseId].sort();
  assert(thirdIds.join() === '0005,0009', `3rd-place game is 0009 vs 0005, got ${thirdIds}`);
  assert(third.rounds[0].games[0].winnerFranchiseId === '0009', '3rd place: 0009 wins');
  console.log('✓ live: 3rd-place game routed to its own bracket (0009 def 0005)');

  // --- LIVE: no bracket definitions → fail-soft unavailable ---------------------------------------
  delete require.cache[require.resolve('../../src/services/playoffs')];
  const playoffs2 = require('../../src/services/playoffs');
  mflRepo.playoffBrackets = async () => [];
  const none = await playoffs2.getBrackets('ck', '69597');
  assert(none.available === false && none.brackets.length === 0 && none.champion === null, 'no brackets → available:false');
  console.log('✓ live: no bracket definitions → fail-soft available:false');

  console.log('\nPLAYOFFS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
