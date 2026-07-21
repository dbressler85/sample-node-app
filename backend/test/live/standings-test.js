'use strict';
// League standings (PO review Step 5, the league layer): every franchise ranked with
// record + points, my team flagged and matching the dashboard, playoff line drawn.
process.env.MFL_DEMO_MODE = 'true';

const league = require('../../src/services/league');
const demo = require('../../src/demo/fixtures');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const LG = '64097'; // demo: my rank 2, record 2-0
  const out = await league.getStandings('demo-cookie', LG);

  assert(out.leagueId === LG && out.name, 'returns the league identity');
  assert(Array.isArray(out.standings) && out.standings.length >= 8, 'a full standings table');

  // Ranks are 1..N in order, and points-for is non-increasing down the table.
  out.standings.forEach((s, i) => assert(s.rank === i + 1, `row ${i} ranked ${s.rank}`));
  for (let i = 1; i < out.standings.length; i += 1) {
    assert(out.standings[i].pointsFor <= out.standings[i - 1].pointsFor, 'points-for descends with rank');
  }

  // My team is flagged, sits at the dashboard rank, and its record matches.
  const dash = demo.dashboard(LG);
  assert(out.me && out.me.mine, 'my team is identified');
  assert(out.me.rank === dash.standingRank, `my rank ${out.me.rank} matches the dashboard ${dash.standingRank}`);
  assert(out.me.record === dash.record, `my record ${out.me.record} matches the dashboard ${dash.record}`);
  assert(out.standings.filter((s) => s.mine).length === 1, 'exactly one team is mine');
  console.log(`✓ standings: ${out.standings.length} teams, me #${out.me.rank} (${out.me.record}), PF ${out.me.pointsFor}`);

  // Playoff line: the top `playoffSpots` teams are in, the rest out.
  assert(out.playoffSpots > 0, 'a playoff-spot count is exposed');
  assert(out.standings[0].inPlayoffs === true && out.standings[out.standings.length - 1].inPlayoffs === false, 'playoff line drawn');
  console.log(`✓ playoff line at ${out.playoffSpots}: #1 in, #${out.standings.length} out`);

  // --- opponent rosters (browse all teams) ---------------------------------------
  const teamsOut = await league.getTeams('demo-cookie', LG);
  assert(Array.isArray(teamsOut.teams) && teamsOut.teams.length >= 2, 'multiple teams for scouting');
  assert(teamsOut.teams.filter((t) => t.mine).length === 1, 'my team is flagged among the teams');
  const anyTeam = teamsOut.teams[0];
  assert(anyTeam.players.length > 0 && anyTeam.players[0].name, 'teams carry named players');
  // Players are value-sorted within a team, and teams by total value.
  for (let i = 1; i < anyTeam.players.length; i += 1) {
    assert((anyTeam.players[i].value || 0) <= (anyTeam.players[i - 1].value || 0), 'players sorted by value');
  }
  for (let i = 1; i < teamsOut.teams.length; i += 1) {
    assert(teamsOut.teams[i].totalValue <= teamsOut.teams[i - 1].totalValue, 'teams sorted by roster value');
  }
  console.log(`✓ teams: ${teamsOut.teams.length} rosters (${teamsOut.format}), top team ${teamsOut.teams[0].name} @ ${teamsOut.teams[0].totalValue}`);

  // --- transaction feed ----------------------------------------------------------
  const txns = await league.getTransactions('demo-cookie', LG);
  assert(Array.isArray(txns.transactions) && txns.transactions.length >= 3, 'a transaction feed');
  const trade = txns.transactions.find((t) => t.type === 'TRADE');
  assert(trade && trade.withFranchise && trade.withFranchise.name, 'a trade names the other franchise');
  assert(trade.added.every((a) => a.name) && trade.dropped.every((a) => a.name), 'trade assets resolve to names');
  const wvr = txns.transactions.find((t) => t.type === 'BBID_WAIVER');
  assert(wvr && wvr.typeLabel === 'Waiver (FAAB)' && wvr.added.length && wvr.dropped.length, 'a waiver add/drop resolves + labels');
  assert(txns.transactions.every((t) => t.franchise && t.franchise.name && t.typeLabel), 'every row has a franchise + label');
  console.log(`✓ transactions: ${txns.transactions.length} rows — e.g. ${trade.franchise.name} ${trade.typeLabel} w/ ${trade.withFranchise.name} (+${trade.added.map((a) => a.name).join(', ')})`);

  console.log('\nSTANDINGS HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
