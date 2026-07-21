'use strict';
// Stubbed LIVE-mode harness for the portfolio dashboard + value-at-risk: totals,
// value-weighted age, age curve, and risk classification (hurt starter vs aging).
process.env.MFL_DEMO_MODE = 'false';
process.env.MFL_WEEK = '3';

const mfl = require('../../src/lib/mfl');

// FantasyCalc values (max 8000 -> 100). Ages via maybeAge.
const FC = [
  { player: { mflId: '1', sleeperId: 'S1', maybeAge: 24 }, value: 8000, overallRank: 1 }, // young star, healthy
  { player: { mflId: '2', sleeperId: 'S2', maybeAge: 30 }, value: 4000, overallRank: 10 }, // aging RB (cliff 27)
  { player: { mflId: '3', sleeperId: 'S3', maybeAge: 25 }, value: 2000, overallRank: 30 }, // hurt starter (OUT)
];
global.fetch = async (url) => ({ ok: true, json: async () => (url.includes('fantasycalc') ? FC : []) });

const PLAYERS = [
  { id: '1', name: 'Young, WR', position: 'WR', team: 'AAA' },
  { id: '2', name: 'Veteran, RB', position: 'RB', team: 'BBB' },
  { id: '3', name: 'Hurt, WR', position: 'WR', team: 'CCC' },
];

mfl.exportRequest = async (type) => {
  switch (type) {
    case 'myleagues':
      return { leagues: { league: [{ league_id: '1000', name: 'Test League', url: 'https://www10.myfantasyleague.com/2026/home/1000', franchise_id: '0001', franchise_name: 'My Team' }] } };
    case 'players':
      return { players: { player: PLAYERS } };
    case 'rosters':
      return { rosters: { franchise: [{ id: '0001', player: ['1', '2', '3'].map((id) => ({ id, status: 'starter' })) }] } };
    case 'league':
      return { league: { starters: { position: [{ name: 'QB', limit: '1' }, { name: 'RB', limit: '1' }, { name: 'WR', limit: '2' }] }, franchises: { franchise: [{ id: '0001', name: 'My Team' }] } } };
    case 'injuries':
      return { injuries: { injury: [{ id: '3', status: 'OUT' }] } };
    case 'nflSchedule':
      return { nflSchedule: { matchup: ['AAA', 'BBB', 'CCC'].map((t) => ({ team: [{ id: t }] })) } };
    case 'futureDraftPicks':
      return { futureDraftPicks: { franchise: { id: '0001', futureDraftPick: [] } } };
    default:
      return {};
  }
};

const portfolio = require('../../src/services/portfolio');
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };

(async () => {
  const d = await portfolio.getDashboard('ck', 'tk');
  console.log('totals:', JSON.stringify(d.totals));
  console.log('atRisk:', JSON.stringify({ injured: d.atRisk.injured, aging: d.atRisk.aging, total: d.atRisk.totalValue, pct: d.atRisk.pct }));

  // Totals: values 100 + 50 + 25 = 175; value-weighted age = (24*100+30*50+25*25)/175.
  assert(d.totals.rosterValue === 175, `total value 175, got ${d.totals.rosterValue}`);
  assert(d.totals.playerCount === 3, `3 valued players, got ${d.totals.playerCount}`);
  assert(d.totals.valueWeightedAge === 25.9, `value-weighted age 25.9, got ${d.totals.valueWeightedAge}`);

  // Risk: hurt starter (#3, OUT, value 25) + aging RB (#2, age 30, value 50). #1 is
  // young & healthy -> not at risk. Distinct total = 75 (43%).
  assert(d.atRisk.injured.count === 1 && d.atRisk.injured.value === 25, `injured = 1 player / 25, got ${JSON.stringify(d.atRisk.injured)}`);
  assert(d.atRisk.aging.count === 1 && d.atRisk.aging.value === 50, `aging = 1 player / 50, got ${JSON.stringify(d.atRisk.aging)}`);
  assert(d.atRisk.totalValue === 75 && d.atRisk.pct === 43, `total at risk 75 / 43%, got ${d.atRisk.totalValue}/${d.atRisk.pct}`);
  assert(d.atRisk.top[0].value === 50, `biggest risk first (aging RB, 50), got ${d.atRisk.top[0].value}`);
  assert(!d.atRisk.top.some((p) => p.id === '1'), 'healthy young star is not flagged at risk');
  console.log('✓ value-at-risk: hurt starter + aging core classified; young star excluded');

  // Age curve: #1 (24) + #3 (25) -> 24–25 band value 125; #2 (30) -> 30+ band 50.
  const band2425 = d.ageCurve.find((b) => b.band === '24–25');
  const band30 = d.ageCurve.find((b) => b.band === '30+');
  assert(band2425.value === 125 && band2425.count === 2, `24-25 band 125/2, got ${JSON.stringify(band2425)}`);
  assert(band30.value === 50 && band30.count === 1, `30+ band 50/1, got ${JSON.stringify(band30)}`);
  console.log('✓ age curve: value distributed by age band');

  // Per-league breakdown carries value + risk.
  assert(d.byLeague.length === 1 && d.byLeague[0].atRiskValue === 75, `per-league risk carried, got ${JSON.stringify(d.byLeague[0])}`);
  console.log('✓ per-league breakdown present');

  // Top holdings: each player aggregated across leagues, biggest first, with exposure + share.
  assert(d.holdings.length === 3, `3 holdings, got ${d.holdings.length}`);
  assert(d.holdings[0].id === '1' && d.holdings[0].value === 100 && d.holdings[0].leagues === 1, `top holding is the young WR at 100 in 1 league, got ${JSON.stringify(d.holdings[0])}`);
  assert(d.holdings[0].pct === 57, `top holding is 57% of the portfolio, got ${d.holdings[0].pct}`);
  console.log('✓ top holdings aggregated with exposure + portfolio share');

  // Allocation by position: WR 100+25=125 (71%), RB 50 (29%).
  const wr = d.allocation.find((a) => a.position === 'WR');
  const rb = d.allocation.find((a) => a.position === 'RB');
  assert(d.allocation[0].position === 'WR' && wr.value === 125 && wr.pct === 71, `WR allocation 125/71%, got ${JSON.stringify(wr)}`);
  assert(rb.value === 50 && rb.pct === 29, `RB allocation 50/29%, got ${JSON.stringify(rb)}`);
  console.log('✓ allocation by position (WR-heavy) computed');

  // Value-over-time: a point is recorded today; change is null until a second day accrues.
  assert(Array.isArray(d.history) && d.history.length >= 1, `history has at least today's point, got ${d.history.length}`);
  assert(d.history[d.history.length - 1].value === 175, `today's point is the current total (175), got ${d.history[d.history.length - 1].value}`);
  console.log('✓ value-over-time records the current total');

  console.log('\nPORTFOLIO DASHBOARD HARNESS PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
