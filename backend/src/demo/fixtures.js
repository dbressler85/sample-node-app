'use strict';

// Fixture data for DEMO_MODE. Mirrors the *normalized* shapes our own API returns,
// so the mobile app can be built and demoed end-to-end without a real MFL account.
// Shapes intentionally resemble MFL's own so swapping in live data is mechanical.

const PLAYERS = [
  { id: '13593', name: 'Jefferson, Justin', position: 'WR', team: 'MIN' },
  { id: '14802', name: 'Chase, Ja\'Marr', position: 'WR', team: 'CIN' },
  { id: '15267', name: 'Robinson, Bijan', position: 'RB', team: 'ATL' },
  { id: '15859', name: 'Harrison, Marvin', position: 'WR', team: 'ARI' },
  { id: '13116', name: 'Jackson, Lamar', position: 'QB', team: 'BAL' },
  { id: '14086', name: 'Hall, Breece', position: 'RB', team: 'NYJ' },
  { id: '15264', name: 'Nabers, Malik', position: 'WR', team: 'NYG' },
  { id: '12171', name: 'Kelce, Travis', position: 'TE', team: 'KC' },
  { id: '14990', name: 'Stroud, C.J.', position: 'QB', team: 'HOU' },
  { id: '15870', name: 'Nix, Bo', position: 'QB', team: 'DEN' },
  { id: '14106', name: 'Olave, Chris', position: 'WR', team: 'NO' },
  { id: '13649', name: 'Gibbs, Jahmyr', position: 'RB', team: 'DET' },
  { id: '14835', name: 'Bowers, Brock', position: 'TE', team: 'LV' },
  { id: '11686', name: 'Cook, Dalvin', position: 'RB', team: 'FA' },
  { id: '15266', name: 'Odunze, Rome', position: 'WR', team: 'CHI' },
  { id: '13138', name: 'London, Drake', position: 'WR', team: 'ATL' },
  // Free-agent / waiver-wire targets (not on my rosters).
  { id: '16001', name: 'Mims Jr., Marvin', position: 'WR', team: 'DEN' },
  { id: '16002', name: 'Tracy Jr., Tyrone', position: 'RB', team: 'NYG' },
  { id: '16003', name: 'Dowdle, Rico', position: 'RB', team: 'DAL' },
  { id: '16004', name: "Robinson, Wan'Dale", position: 'WR', team: 'NYG' },
  { id: '16005', name: 'Ferguson, Jake', position: 'TE', team: 'DAL' },
  // Incoming rookie draft class (the pool for offseason rookie drafts).
  { id: '19001', name: 'Marliss, Jayden', position: 'QB', team: 'NE' },
  { id: '19002', name: 'Okafor, Terrence', position: 'RB', team: 'LAC' },
  { id: '19003', name: 'Bellamy, Deion', position: 'WR', team: 'CLE' },
  { id: '19004', name: 'Voss, Kaden', position: 'TE', team: 'GB' },
  { id: '19005', name: 'Ridley, Amari', position: 'WR', team: 'SEA' },
  { id: '19006', name: 'Cormier, Jaylen', position: 'RB', team: 'TEN' },
  // Kickers (position PK) — for leagues that start a kicker.
  { id: '17001', name: 'McPherson, Evan', position: 'PK', team: 'CIN' },
  { id: '17002', name: 'Bass, Tyler', position: 'PK', team: 'BUF' },
  { id: '17003', name: 'Aubrey, Brandon', position: 'PK', team: 'DAL' },
  { id: '17004', name: 'Koo, Younghoe', position: 'PK', team: 'ATL' }, // ATL bye this week
  // Team defenses (position DEF) — for leagues that start a D/ST.
  { id: '18001', name: '49ers D/ST', position: 'DEF', team: 'SF' },
  { id: '18002', name: 'Cowboys D/ST', position: 'DEF', team: 'DAL' },
  { id: '18003', name: 'Ravens D/ST', position: 'DEF', team: 'BAL' },
  { id: '18004', name: 'Falcons D/ST', position: 'DEF', team: 'ATL' }, // ATL bye this week
];

// Three dynasty leagues on different MFL hosts, as `myleagues` would return them.
const LEAGUES = [
  {
    leagueId: '64097',
    host: 'www55.myfantasyleague.com',
    name: 'Dynasty Warlords',
    franchiseId: '0003',
    franchiseName: 'Gridiron Ghosts',
    url: 'https://www55.myfantasyleague.com/2026/home/64097',
  },
  {
    leagueId: '40750',
    host: 'www47.myfantasyleague.com',
    name: 'The Superflex Society',
    franchiseId: '0007',
    franchiseName: 'Gridiron Ghosts',
    url: 'https://www47.myfantasyleague.com/2026/home/40750',
  },
  {
    leagueId: '19622',
    host: 'www54.myfantasyleague.com',
    name: 'Keeper Kings PPR',
    franchiseId: '0011',
    franchiseName: 'Gridiron Ghosts',
    url: 'https://www54.myfantasyleague.com/2026/home/19622',
  },
];

const WEEK = 3;

// Per-league dashboard snapshot: my matchup, score, record, standing.
const DASHBOARD = {
  '64097': {
    week: WEEK,
    record: '2-0',
    standingRank: 2,
    matchup: {
      me: { name: 'Gridiron Ghosts', score: 78.4, projected: 121.6 },
      opponent: { name: 'Waiver Wire Wolves', score: 64.1, projected: 110.2 },
    },
  },
  '40750': {
    week: WEEK,
    record: '1-1',
    standingRank: 6,
    matchup: {
      me: { name: 'Gridiron Ghosts', score: 91.0, projected: 133.8 },
      opponent: { name: 'Superflex Savants', score: 102.7, projected: 140.1 },
    },
  },
  '19622': {
    week: WEEK,
    record: '2-0',
    standingRank: 1,
    matchup: {
      me: { name: 'Gridiron Ghosts', score: 55.2, projected: 118.9 },
      opponent: { name: 'Dynasty Destroyers', score: 60.8, projected: 115.4 },
    },
  },
};

// A pool of rival team names to flesh out demo standings/rosters without hand-typing a
// full table per league. My franchise ("Gridiron Ghosts") is placed at its known rank.
const FRANCHISE_POOL = [
  'Waiver Wire Wolves', 'Dynasty Destroyers', 'Superflex Savants', 'Trade Deadline Titans',
  'Bye Week Bandits', 'Practice Squad Heroes', 'Hail Mary Hooligans', 'Red Zone Raiders',
  'Garbage Time Gods', 'Pigskin Prophets', 'Fourth Down Fugitives', 'Checkdown Charlies',
];

// A deterministic 10-team standings table for a demo league, anchored on my known record
// and rank from DASHBOARD. Weeks 1–2 are complete (WEEK=3), so records run 2-0 / 1-1 / 0-2
// by standings tier, points-for descending with rank.
function demoStandings(leagueId) {
  const dash = DASHBOARD[leagueId];
  const lg = LEAGUES.find((l) => l.leagueId === leagueId);
  if (!dash || !lg) return [];
  const N = 10;
  const myRank = Math.min(dash.standingRank || 1, N);
  const names = [];
  let pool = 0;
  for (let rank = 1; rank <= N; rank += 1) {
    if (rank === myRank) { names.push({ id: lg.franchiseId, name: lg.franchiseName, mine: true }); continue; }
    names.push({ id: String(1000 + rank).padStart(4, '0'), name: FRANCHISE_POOL[pool % FRANCHISE_POOL.length], mine: false });
    pool += 1;
  }
  return names.map((t, i) => {
    const rank = i + 1;
    const wins = rank <= 3 ? 2 : rank <= 7 ? 1 : 0;
    const losses = 2 - wins;
    const pf = Math.round((1360 - rank * 42) * 10) / 10; // descending with rank
    const pa = Math.round((1180 + (rank - 5) * 18) * 10) / 10;
    return { id: t.id, name: t.name, mine: t.mine, h2hw: wins, h2hl: losses, h2ht: 0, pf, pa };
  });
}

// A demo playoff bracket for a league, in the NORMALIZED shape the /playoffs endpoint returns
// (the live service maps MFL's playoffBrackets export into the same shape). A 6-team single-
// elimination Championship bracket built off the standings seeds; my franchise is seeded 4th and
// runs the table to the title, so the UI shows a winner path, upsets, and my-team highlighting.
function demoPlayoffBrackets(leagueId) {
  const st = demoStandings(leagueId);
  const lg = LEAGUES.find((l) => l.leagueId === leagueId);
  if (!st.length || !lg) return null;
  // Six seeds from the standings, then place MY franchise at seed 4 — the champion path in this
  // fixture's scores — so the demo always tells the same "4-seed runs the table" story regardless of
  // where I actually sit in the standings.
  const top = st.slice(0, 6).map((t, i) => ({ franchiseId: String(t.id), name: t.name, seed: i + 1, mine: !!t.mine }));
  const meIdx = top.findIndex((s) => s.mine);
  if (meIdx === -1) {
    top[3] = { franchiseId: lg.franchiseId, name: lg.franchiseName, seed: 4, mine: true };
  } else if (meIdx !== 3) {
    const displaced = { ...top[3], seed: meIdx + 1 };
    top[3] = { ...top[meIdx], seed: 4 };
    top[meIdx] = displaced;
  }
  const bySeed = Object.fromEntries(top.map((s) => [s.seed, s]));
  const side = (seed, points) => {
    const s = bySeed[seed];
    return s ? { franchiseId: s.franchiseId, name: s.name, seed: s.seed, points, mine: s.mine } : null;
  };
  const game = (id, hSeed, hPts, aSeed, aPts, winSeed) => {
    const home = side(hSeed, hPts);
    const away = side(aSeed, aPts);
    const w = bySeed[winSeed];
    return {
      id,
      home,
      away,
      winnerFranchiseId: w ? w.franchiseId : null,
      status: 'final',
      mine: !!((home && home.mine) || (away && away.mine)),
    };
  };
  return {
    leagueId,
    name: lg.name,
    myFranchiseId: lg.franchiseId,
    available: true,
    brackets: [
      {
        id: 'championship',
        name: 'Championship',
        rounds: [
          // Top 2 seeds get a bye; seeds 3–6 play the Wild Card round.
          { week: 15, title: 'Wild Card', games: [game('wc1', 3, 108.4, 6, 96.2, 3), game('wc2', 4, 121.0, 5, 118.7, 4)] },
          { week: 16, title: 'Semifinals', games: [game('sf1', 1, 101.3, 4, 116.9, 4), game('sf2', 2, 124.5, 3, 110.0, 2)] },
          { week: 17, title: 'Championship', games: [game('final', 4, 131.2, 2, 122.8, 4)] },
        ],
      },
    ],
  };
}

// Recent league transactions (newest first), in the service's raw shape: a type, a
// timestamp, the acting franchise, added/dropped player ids, and (for trades) the other
// franchise. Fixed timestamps so the demo is deterministic.
const TRANSACTIONS = {
  '64097': [
    { id: 'tx-1', type: 'TRADE', at: 1725300000, franchiseId: '0003', franchiseName: 'Gridiron Ghosts', withFranchiseId: '0004', withFranchiseName: 'Waiver Wire Wolves', addedIds: ['15264'], droppedIds: ['11686'] },
    { id: 'tx-2', type: 'BBID_WAIVER', at: 1725213600, franchiseId: '0008', franchiseName: 'Rebuild Raccoons', addedIds: ['13138'], droppedIds: ['14106'] },
    { id: 'tx-3', type: 'FREE_AGENT', at: 1725127200, franchiseId: '0003', franchiseName: 'Gridiron Ghosts', addedIds: ['17001'], droppedIds: [] },
    { id: 'tx-4', type: 'IR', at: 1725040800, franchiseId: '0003', franchiseName: 'Gridiron Ghosts', addedIds: [], droppedIds: [] },
  ],
  '40750': [
    { id: 'tx-5', type: 'BBID_WAIVER', at: 1725250000, franchiseId: '0007', franchiseName: 'Gridiron Ghosts', addedIds: ['15266'], droppedIds: ['13138'] },
    { id: 'tx-6', type: 'TRADE', at: 1725150000, franchiseId: '0002', franchiseName: 'Superflex Savants', withFranchiseId: '0009', withFranchiseName: 'Dynasty Sharks', addedIds: ['13116'], droppedIds: ['14106'] },
  ],
  '19622': [
    { id: 'tx-7', type: 'FREE_AGENT', at: 1725260000, franchiseId: '0011', franchiseName: 'Gridiron Ghosts', addedIds: ['13138'], droppedIds: ['11686'] },
  ],
};

// Per-league roster (ids into PLAYERS). starters/bench/ir/taxi.
const ROSTERS = {
  '64097': {
    starters: ['13116', '15267', '13649', '13593', '14802', '12171', '17001', '18001'],
    bench: ['15264', '13138', '11686'],
    ir: ['14106'],
    taxi: ['15266'],
  },
  '40750': {
    starters: ['14990', '15870', '14086', '15859', '15264', '14835'],
    bench: ['13593', '15266', '13138'],
    ir: [],
    taxi: [], // (previously duplicated a starter; taxi is demonstrated on 64097)
  },
  '19622': {
    starters: ['13116', '15267', '13649', '14802', '13138', '12171', '17003', '18003'],
    bench: ['14106', '11686'],
    ir: [],
    taxi: [],
  },
};

// My roster's strength percentile within each demo league (0..1; 1.0 = strongest
// team in the league). Live mode computes this by ranking my roster value against
// every franchise's; demo can't (fixtures don't carry full opponent rosters), so we
// pin plausible values. Chosen to show the model separating two similarly-YOUNG
// rosters by strength: 64097 (young + strong → Ascending) vs 40750 (young + weak →
// Rebuilding), plus 19622 (strong, older core → Win-now window).
const TEAM_STRENGTH = {
  '64097': 0.75,
  '40750': 0.3,
  '19622': 0.8,
};

// Example "on the block" so the centralized trade-bait view demos populated. Each is a
// player the demo rosters actually hold (bench depth you'd shop). Real use replaces
// this the moment the user blocks their own player.
const TRADE_BAIT = [
  { leagueId: '64097', playerId: '11686', note: 'Selling high — open to a young WR + pick' },
  { leagueId: '40750', playerId: '13593', note: null },
];

// What OTHER franchises have listed on the league's Trade Bait board (live: read from
// MFL's tradeBait export). Lets suggestions/counters lean on players a rival has already
// said they'll move. Ids are on those franchises' partner rosters below.
const TRADE_BAIT_BOARD = {
  '64097': [{ franchiseId: '0004', willGiveUp: ['15264'] }, { franchiseId: '0008', willGiveUp: ['15870', '14106'] }],
  '40750': [{ franchiseId: '0002', willGiveUp: ['12171'] }, { franchiseId: '0009', willGiveUp: ['13116'] }],
  '19622': [{ franchiseId: '0005', willGiveUp: ['13593'] }],
};

// Projected RAW stats for the current week, keyed by player id. These are
// format-independent — the per-league scoring settings below turn them into
// points, so the same player is worth different points in different leagues.
const STAT_PROJECTIONS = {
  // QBs: passYds, passTd, passInt, rushYds, rushTd
  '13116': { passYds: 250, passTd: 1.8, passInt: 0.6, rushYds: 55, rushTd: 0.5 }, // Lamar
  '14990': { passYds: 275, passTd: 1.9, passInt: 0.7, rushYds: 12, rushTd: 0.1 }, // Stroud
  '15870': { passYds: 235, passTd: 1.6, passInt: 0.6, rushYds: 28, rushTd: 0.3 }, // Nix
  // RBs: rushYds, rushTd, rec, recYds, recTd
  '15267': { rushYds: 78, rushTd: 0.6, rec: 3.5, recYds: 28, recTd: 0.2 }, // Bijan
  '13649': { rushYds: 72, rushTd: 0.6, rec: 3.2, recYds: 30, recTd: 0.2 }, // Gibbs
  '14086': { rushYds: 68, rushTd: 0.5, rec: 4.0, recYds: 33, recTd: 0.2 }, // Hall
  '11686': { rushYds: 40, rushTd: 0.2, rec: 1.5, recYds: 10, recTd: 0.0 }, // Cook
  // WRs: rec, recYds, recTd
  '13593': { rec: 6.8, recYds: 92, recTd: 0.6 }, // Jefferson
  '14802': { rec: 7.2, recYds: 95, recTd: 0.7 }, // Chase
  '15264': { rec: 6.5, recYds: 78, recTd: 0.4 }, // Nabers
  '15859': { rec: 5.5, recYds: 72, recTd: 0.45 }, // Harrison
  '14106': { rec: 5.8, recYds: 70, recTd: 0.35 }, // Olave
  '13138': { rec: 5.6, recYds: 68, recTd: 0.35 }, // London
  '15266': { rec: 4.8, recYds: 58, recTd: 0.3 }, // Odunze
  // TEs: rec, recYds, recTd
  '12171': { rec: 6.0, recYds: 62, recTd: 0.45 }, // Kelce
  '14835': { rec: 5.5, recYds: 58, recTd: 0.4 }, // Bowers
  // Free agents
  '16001': { rec: 4.0, recYds: 55, recTd: 0.3 }, // Mims WR
  '16002': { rushYds: 62, rushTd: 0.4, rec: 2.5, recYds: 18, recTd: 0.1 }, // Tracy RB
  '16003': { rushYds: 48, rushTd: 0.3, rec: 1.5, recYds: 10, recTd: 0.0 }, // Dowdle RB
  '16004': { rec: 5.0, recYds: 48, recTd: 0.2 }, // Wan'Dale WR
  '16005': { rec: 4.5, recYds: 44, recTd: 0.3 }, // Ferguson TE
  // Kickers: xp (extra points), fgAny (FG made < 50), fg50 (FG made 50+)
  '17001': { xp: 2.6, fgAny: 1.7, fg50: 0.5 }, // McPherson
  '17002': { xp: 2.4, fgAny: 1.6, fg50: 0.4 }, // Bass
  '17003': { xp: 2.8, fgAny: 1.8, fg50: 0.6 }, // Aubrey
  '17004': { xp: 2.2, fgAny: 1.5, fg50: 0.3 }, // Koo
  // Defenses: sack, defInt, fumRec, defTd, safety, pointsAllowed (expected)
  '18001': { sack: 3.0, defInt: 1.0, fumRec: 0.7, defTd: 0.2, pointsAllowed: 17 }, // 49ers
  '18002': { sack: 2.6, defInt: 0.9, fumRec: 0.6, defTd: 0.15, pointsAllowed: 20 }, // Cowboys
  '18003': { sack: 2.8, defInt: 0.9, fumRec: 0.6, defTd: 0.18, pointsAllowed: 18 }, // Ravens
  '18004': { sack: 2.2, defInt: 0.7, fumRec: 0.5, defTd: 0.1, pointsAllowed: 22 }, // Falcons
};

// Per-league scoring settings — deliberately different formats so the optimizer
// has to account for each: standard, superflex + 6pt passing TDs, and PPR with a
// tight-end premium.
// Per-league scoring settings. Note kicker/defense scoring also varies by league:
// Dynasty Warlords uses a plain kicker/defense scale, while Keeper Kings rewards
// long field goals and "big-play" defenses (double sacks, richer turnovers) — so
// the SAME kicker or D/ST is worth different points in each, just like skill
// players under PPR. (Live leagues get this for free from MFL's projectedScores.)
const SCORING = {
  '64097': { ppr: 0, tePremium: 0, passTd: 4 }, // Dynasty Warlords — standard, 4pt PaTD, default K/DEF
  '40750': { ppr: 1, tePremium: 0, passTd: 6 }, // Superflex Society — full PPR, 6pt PaTD (no K/DEF slots)
  '19622': {
    ppr: 1,
    tePremium: 0.5,
    passTd: 4, // Keeper Kings — full PPR + TE premium
    // Distance-weighted kicker + big-play defense scoring (differs from Warlords):
    fg50: 6, // long FGs worth more (vs 5 default)
    sack: 2, // double sacks (vs 1 default)
    defInt: 3, // richer turnovers (vs 2 default)
    fumRec: 3, // richer turnovers (vs 2 default)
  },
};

// Starting lineup requirements per league. Deliberately varied to exercise the
// optimizer: a standard league (already optimal), a superflex league (a bench WR
// should start), and a PPR flex league (a starting slot is left empty).
const LINEUP_REQS = {
  '64097': [
    { name: 'QB', eligible: ['QB'], count: 1 },
    { name: 'RB', eligible: ['RB'], count: 2 },
    { name: 'WR', eligible: ['WR'], count: 2 },
    { name: 'TE', eligible: ['TE'], count: 1 },
    { name: 'PK', eligible: ['PK'], count: 1 },
    { name: 'DEF', eligible: ['DEF'], count: 1 },
  ],
  '40750': [
    { name: 'QB', eligible: ['QB'], count: 1 },
    { name: 'RB', eligible: ['RB'], count: 1 },
    { name: 'WR', eligible: ['WR'], count: 2 },
    { name: 'TE', eligible: ['TE'], count: 1 },
    { name: 'SUPERFLEX', eligible: ['QB', 'RB', 'WR', 'TE'], count: 1 },
  ],
  '19622': [
    { name: 'QB', eligible: ['QB'], count: 1 },
    { name: 'RB', eligible: ['RB'], count: 2 },
    { name: 'WR', eligible: ['WR'], count: 2 },
    { name: 'TE', eligible: ['TE'], count: 1 },
    { name: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 },
    { name: 'PK', eligible: ['PK'], count: 1 },
    { name: 'DEF', eligible: ['DEF'], count: 1 },
  ],
};

// Injury / game statuses for the current week (default ACTIVE if absent).
// Harrison is OUT (a current starter who must be benched), Chase is Questionable.
const PLAYER_STATUS = {
  '15859': 'OUT', // Harrison — a Superflex starter; optimizer must replace him
  '14802': 'QUESTIONABLE', // Chase — playable but flagged
};

// Team bye weeks. ATL is on bye this week, which sidelines multiple rostered
// players across leagues (Robinson, London) — a real cross-league headache.
const BYES = { ATL: 3 };

// This week's opponent projected totals (median), used for win probability and
// the safe/aggressive recommendation.
const MATCHUP_PROJECTION = {
  '64097': { opponent: 'Waiver Wire Wolves', projected: 96.0 },
  '40750': { opponent: 'Superflex Savants', projected: 118.0 },
  '19622': { opponent: 'Dynasty Destroyers', projected: 121.0 },
};

// Dynasty context per player: age and a 0-100 dynasty trade value. This is the
// core lens for dynasty roster decisions (age curves + asset value).
const DYNASTY = {
  '13593': { age: 26, value: 95 }, // Jefferson
  '14802': { age: 25, value: 98 }, // Chase
  '15267': { age: 24, value: 96 }, // Bijan
  '15859': { age: 23, value: 88 }, // Harrison
  '13116': { age: 29, value: 82 }, // Lamar
  '14086': { age: 25, value: 84 }, // Hall
  '15264': { age: 23, value: 92 }, // Nabers
  '12171': { age: 36, value: 38 }, // Kelce
  '14990': { age: 24, value: 90 }, // Stroud
  '15870': { age: 25, value: 72 }, // Nix
  '14106': { age: 25, value: 78 }, // Olave
  '13649': { age: 24, value: 91 }, // Gibbs
  '14835': { age: 23, value: 89 }, // Bowers
  '11686': { age: 30, value: 18 }, // Cook
  '15266': { age: 23, value: 80 }, // Odunze
  '13138': { age: 24, value: 83 }, // London
  '16001': { age: 23, value: 35 }, // Mims
  '16002': { age: 24, value: 42 }, // Tracy
  '16003': { age: 26, value: 28 }, // Dowdle
  '16004': { age: 24, value: 33 }, // Wan'Dale
  '16005': { age: 26, value: 37 }, // Ferguson
  // Kickers / defenses carry little dynasty value (streamed year to year), but a
  // nominal value keeps them sortable on the board. Defenses use a nominal age.
  '17001': { age: 26, value: 14 }, // McPherson
  '17002': { age: 28, value: 11 }, // Bass
  '17003': { age: 30, value: 13 }, // Aubrey
  '17004': { age: 31, value: 9 }, // Koo
  '18001': { age: 26, value: 15 }, // 49ers D/ST
  '18002': { age: 26, value: 12 }, // Cowboys D/ST
  '18003': { age: 26, value: 13 }, // Ravens D/ST
  '18004': { age: 26, value: 10 }, // Falcons D/ST
  // Rookie class (young, high dynasty value at the top of the draft).
  '19001': { age: 22, value: 70 }, // Marliss QB
  '19002': { age: 21, value: 78 }, // Okafor RB
  '19003': { age: 21, value: 82 }, // Bellamy WR
  '19004': { age: 22, value: 55 }, // Voss TE
  '19005': { age: 22, value: 60 }, // Ridley WR
  '19006': { age: 21, value: 58 }, // Cormier RB
};

// Rookie draft class (ids into PLAYERS) — the shared pool for rookie drafts.
const DRAFT_CLASS = ['19003', '19002', '19001', '19005', '19006', '19004'];

// Average draft position for the class — the market-consensus order, deliberately NOT
// the same as dynasty value (e.g. the RB goes 1st by ADP even though a superflex QB is
// worth more), so the board's ADP ordering is visibly its own signal.
const ADP = {
  '19002': 1.4, // Okafor RB
  '19003': 2.1, // Bellamy WR
  '19001': 3.3, // Marliss QB
  '19006': 4.6, // Cormier RB
  '19005': 5.2, // Ridley WR
  '19004': 6.8, // Voss TE
};

// Per-league drafts in different states: one scheduled (future), one live (with
// me on the clock), one complete. franchiseId matches my team in each league.
const DRAFTS = {
  '64097': {
    status: 'scheduled',
    type: 'Rookie draft',
    startTime: '2026-08-15T23:00:00Z',
    rounds: 4,
    snake: true,
    order: ['0004', '0008', '0003', '0011'], // 0003 = me
    picks: [],
  },
  '40750': {
    status: 'in_progress',
    type: 'Rookie draft',
    startTime: '2026-08-10T23:00:00Z',
    rounds: 2,
    snake: true,
    order: ['0002', '0009', '0007'], // 0007 = me; I'm on the clock at 1.03
    picks: [
      { round: 1, pick: 1, franchiseId: '0002', playerId: '19002' },
      { round: 1, pick: 2, franchiseId: '0009', playerId: '19003' },
    ],
  },
  '19622': {
    status: 'complete',
    type: 'Rookie draft',
    startTime: '2026-07-01T23:00:00Z',
    rounds: 1,
    snake: true,
    order: ['0005', '0011'], // 0011 = me
    picks: [
      { round: 1, pick: 1, franchiseId: '0005', playerId: '19001' },
      { round: 1, pick: 2, franchiseId: '0011', playerId: '19004' },
    ],
  },
};

// Live matchup detail for the current week: live points, players yet to play,
// and projected final for me and my opponent. Drives the live scoreboard.
const LIVE = {
  '64097': {
    me: { score: 78.4, yetToPlay: 3, projectedFinal: 121.6, yetToPlayIds: ['13593', '14802', '12171'] },
    opp: { score: 84.1, yetToPlay: 2, projectedFinal: 118.0 },
  },
  '40750': {
    me: { score: 91.0, yetToPlay: 1, projectedFinal: 133.8, yetToPlayIds: ['14990'] },
    opp: { score: 102.7, yetToPlay: 1, projectedFinal: 140.1 },
  },
  '19622': {
    me: { score: 55.2, yetToPlay: 6, projectedFinal: 118.9, yetToPlayIds: ['13116', '15267', '13649', '14802', '13138', '12171'] },
    opp: { score: 60.8, yetToPlay: 5, projectedFinal: 121.0 },
  },
};

// Pending trade offers awaiting my response, per league. Assets are player ids
// (into PLAYERS) or 'pick:LABEL' tokens. `acquire` = what I'd receive, `send` =
// what I'd give up.
const TRADE_OFFERS = {
  '40750': [
    { id: 't1', withFranchiseId: '0002', withName: 'Superflex Savants', acquire: ['13649'], send: ['15870'] }, // Gibbs for my Nix
    // FAAB is tradeable: they offer a player + $20 of blind-bidding budget for my Nix. MFL
    // represents the budget as a BB_<dollars> token in the give/receive lists.
    { id: 't3', withFranchiseId: '0009', withName: 'Dynasty Sharks', acquire: ['14106', 'BB_20'], send: ['15870'] },
  ],
  '19622': [
    { id: 't2', withFranchiseId: '0005', withName: 'Rebuild Rangers', acquire: ['pick:2027 1st', 'pick:2027 2nd'], send: ['13649'] }, // picks for my Gibbs
  ],
};

// Other franchises in each league + their (tradeable) rosters, for proposing.
const TRADE_PARTNERS = {
  '64097': [
    { franchiseId: '0004', name: 'Waiver Wire Wolves', roster: ['14990', '15264', '16002'] },
    { franchiseId: '0008', name: 'Rebuild Raccoons', roster: ['15870', '14106', '16005'] },
  ],
  '40750': [
    { franchiseId: '0002', name: 'Superflex Savants', roster: ['13649', '14802', '12171', '16005'] },
    { franchiseId: '0009', name: 'Dynasty Sharks', roster: ['15267', '13116', '14106'] },
  ],
  '19622': [
    { franchiseId: '0005', name: 'Rebuild Rangers', roster: ['13593', '15859', '16005'] },
  ],
};

function assetLabel(tok) {
  const t = String(tok);
  if (t.startsWith('pick:')) return t.slice(5);
  const p = PLAYERS.find((x) => x.id === t);
  return p ? p.name.split(',')[0] : `Player ${t}`;
}

// Pending waiver / FAAB claims I've queued, per league.
const WAIVERS = {
  '64097': [{ player: 'Cook, Dalvin', bid: 12, runsAt: 'Wed 3:00 AM' }],
};

// League-wide news, mapped to affected teams by whichever leagues roster the player.
// `ageMins` drives a relative publish time (computed at read time in demo), so the News tab
// can show "how long ago" and sort by recency.
const NEWS = [
  { id: 'n1', playerId: '15859', headline: 'Marvin Harrison ruled OUT (ankle)', severity: 'high', ageMins: 95 },
  { id: 'n2', playerId: '15267', headline: 'Bijan Robinson on bye this week', severity: 'medium', ageMins: 20 },
  { id: 'n3', playerId: '14802', headline: "Ja'Marr Chase questionable, expected to play", severity: 'low', ageMins: 600 },
  { id: 'n4', playerId: '13649', headline: 'Jahmyr Gibbs sees season-high snap share', severity: 'low', ageMins: 1500 },
];

// Rookie / future draft pick inventory per league (dynasty currency).
const PICKS = {
  '64097': ['2027 1st', '2027 3rd'],
  '40750': ['2027 1st', '2027 2nd', '2028 1st'],
  '19622': ['2027 2nd'],
};

// Per-league waiver settings. MFL leagues use one of three pickup systems, and
// the claim UX differs for each: blind-bid/FAAB (budget), FCFS (waiver priority),
// or free agents (immediate add/drop). rosterSize is the active-roster limit —
// when full, a claim must include a drop.
const WAIVER_SETTINGS = {
  '64097': { system: 'faab', faabBudget: 100, faabRemaining: 78, minBid: 1, rosterSize: 12, clearTime: 'Wed 3:00 AM ET' },
  '40750': { system: 'fcfs', waiverPriority: 3, waiverTeams: 12, rosterSize: 12, clearTime: 'Wed 3:00 AM ET' },
  '19622': { system: 'free', rosterSize: 8 }, // full roster -> drop required; adds are immediate
};

// Free agents available per league (ids into PLAYERS). Overlap across leagues is
// intentional so the cross-league "best available" view has multi-league targets.
const FREE_AGENTS = {
  '64097': ['16002', '16001', '16005', '16003', '17002', '18002', '17004', '18004'],
  '40750': ['16002', '16004', '16001'], // no kicker/defense slots — none listed
  '19622': ['16002', '16001', '16005', '16003', '17002', '18002', '17004', '18004'],
};

// Waiver-wire heat: how many leagues (market-wide) are adding each player.
const TRENDS = { '16002': 5400, '16001': 3900, '16005': 2800, '16004': 2100, '16003': 1500, '18002': 2600, '17002': 1800, '18004': 900, '17004': 700 };

// Draft class (NFL draft year) — the real rookie signal. The 19xxx prospects are this
// season's rookies; the 16xxx group are second-year. Everyone else is a null/older vet, so
// the Rookies filter shows exactly the current class rather than "anyone young".
const DRAFT_YEARS = { '19001': 2026, '19002': 2026, '19003': 2026, '19004': 2026, '19005': 2026, '19006': 2026, '16001': 2025, '16002': 2025, '16003': 2025, '16004': 2025, '16005': 2025 };

// Real NFL draft slots + a Sleeper headshot id for the demo veterans, so the profile can show
// "Drafted 2020 · Round 1, Pick 22" and a photo (a real live account gets these from MFL's
// DETAILS export + the Sleeper crosswalk). year here also feeds draftYear for these vets.
const DRAFT = {
  '13593': { year: 2020, round: 1, pick: 22, sleeperId: '6794' },  // Jefferson
  '14802': { year: 2021, round: 1, pick: 5, sleeperId: '7564' },   // Chase
  '15267': { year: 2023, round: 1, pick: 8, sleeperId: '9509' },   // Bijan
  '15859': { year: 2024, round: 1, pick: 4, sleeperId: '11631' },  // Marvin Harrison
  '13116': { year: 2018, round: 1, pick: 32, sleeperId: '4881' },  // Lamar
  '14086': { year: 2022, round: 2, pick: 36, sleeperId: '8138' },  // Breece Hall
  '15264': { year: 2024, round: 1, pick: 6, sleeperId: '11566' },  // Nabers
  '12171': { year: 2013, round: 3, pick: 63, sleeperId: '1466' },  // Kelce
  '14990': { year: 2023, round: 1, pick: 2, sleeperId: '9758' },   // Stroud
  '15870': { year: 2024, round: 1, pick: 12, sleeperId: '11563' }, // Bo Nix
  '14106': { year: 2022, round: 1, pick: 11, sleeperId: '8110' },  // Olave
  '13649': { year: 2023, round: 1, pick: 12, sleeperId: '9756' },  // Gibbs
  '14835': { year: 2024, round: 1, pick: 13, sleeperId: '11604' }, // Bowers
  '11686': { year: 2017, round: 2, pick: 41, sleeperId: '4029' },  // Dalvin Cook
  '15266': { year: 2024, round: 1, pick: 9, sleeperId: '11565' },  // Odunze
  '13138': { year: 2022, round: 1, pick: 8, sleeperId: '8112' },   // London
};

// Ownership %: share of leagues site-wide that roster the player. A key waiver
// signal — how contested a pickup is / how fast he's being scooped up.
const OWNERSHIP = { '16002': 41, '16001': 33, '16005': 22, '16004': 18, '16003': 12, '18002': 28, '17002': 24, '18004': 9, '17004': 7 };

// Seed pending claims per league (add/drop ids + bid or priority).
const PENDING_CLAIMS = {
  '64097': [{ system: 'faab', add: '16001', drop: '11686', bid: 15 }],
  '40750': [{ system: 'fcfs', add: '16004', drop: '15266', priority: 3 }],
  '19622': [],
};

// Recently processed claims, for the activity view.
const WAIVER_RESULTS = {
  '64097': [
    { add: 'Flowers, Zay', drop: 'Mooney, Darnell', bid: 8, result: 'won' },
    { add: 'Dowdle, Rico', bid: 4, result: 'lost' },
  ],
};

// Recent game logs (weeks 1-2) keyed by player id. Season totals derive from these.
// Prior-season final fantasy totals (last completed year) for the players with game logs, so a
// player card shows what they actually did last year even in the offseason. Points/games only;
// the service stamps the concrete year (config.season − 1) so it stays correct as seasons roll.
const PRIOR_SEASON = {
  '13593': { points: 268.4, games: 16, stats: { receiving: { rec: 103, yds: 1533, td: 10 } } },
  '14802': { points: 301.7, games: 17, stats: { receiving: { rec: 108, yds: 1612, td: 13 } } },
  '15267': { points: 244.9, games: 15, stats: { rushing: { att: 240, yds: 1102, td: 9 }, receiving: { rec: 44, yds: 335, td: 2 } } },
  '13116': { points: 372.1, games: 17, stats: { passing: { att: 560, cmp: 372, yds: 4210, td: 33 }, rushing: { att: 88, yds: 512, td: 6 } } },
  '13649': { points: 289.5, games: 17, stats: { rushing: { att: 250, yds: 1288, td: 12 }, receiving: { rec: 52, yds: 431, td: 3 } } },
  '12171': { points: 158.3, games: 16, stats: { receiving: { rec: 71, yds: 902, td: 5 } } },
  '14990': { points: 331.0, games: 17, stats: { passing: { att: 520, cmp: 341, yds: 3980, td: 29 }, rushing: { att: 40, yds: 176, td: 2 } } },
  '15264': { points: 226.8, games: 16, stats: { receiving: { rec: 88, yds: 1176, td: 7 } } },
  '14086': { points: 241.2, games: 17, stats: { rushing: { att: 198, yds: 921, td: 7 }, receiving: { rec: 60, yds: 508, td: 3 } } },
  '16002': { points: 198.6, games: 14, stats: { rushing: { att: 176, yds: 843, td: 6 }, receiving: { rec: 28, yds: 191, td: 1 } } },
};

const GAME_LOG = {
  '13593': [{ week: 1, pts: 22.4, line: '7-118, TD' }, { week: 2, pts: 15.1, line: '6-71' }],
  '14802': [{ week: 1, pts: 26.0, line: '9-121, TD' }, { week: 2, pts: 18.4, line: '7-88' }],
  '15267': [{ week: 1, pts: 19.5, line: '84 ru, TD, 3-25' }, { week: 2, pts: 14.2, line: '61 ru, 4-30' }],
  '13116': [{ week: 1, pts: 27.8, line: '250 pa, 2 TD, 60 ru' }, { week: 2, pts: 21.0, line: '210 pa, TD, 45 ru' }],
  '13649': [{ week: 1, pts: 18.0, line: '72 ru, TD, 3-28' }, { week: 2, pts: 16.5, line: '65 ru, 4-33' }],
  '12171': [{ week: 1, pts: 11.0, line: '6-58' }, { week: 2, pts: 8.4, line: '5-44' }],
  '14990': [{ week: 1, pts: 19.2, line: '280 pa, 2 TD' }, { week: 2, pts: 16.0, line: '245 pa, TD' }],
  '15264': [{ week: 1, pts: 17.5, line: '8-92' }, { week: 2, pts: 12.1, line: '6-61' }],
  '14086': [{ week: 1, pts: 15.0, line: '60 ru, 4-40' }, { week: 2, pts: 18.2, line: '78 ru, TD, 3-22' }],
  '16002': [{ week: 1, pts: 12.5, line: '58 ru, 2-15' }, { week: 2, pts: 14.0, line: '70 ru, TD' }],
};

// Upcoming schedule + matchup difficulty (1 easy .. 10 tough) by NFL team.
const SCHEDULE = {
  MIN: [{ week: 4, opp: '@CHI', difficulty: 6 }, { week: 5, opp: 'DET', difficulty: 8 }, { week: 6, opp: '@GB', difficulty: 7 }],
  CIN: [{ week: 4, opp: 'CAR', difficulty: 3 }, { week: 5, opp: '@BAL', difficulty: 8 }, { week: 6, opp: 'PIT', difficulty: 6 }],
  ATL: [{ week: 4, opp: '@NO', difficulty: 5 }, { week: 5, opp: 'TB', difficulty: 6 }, { week: 6, opp: '@CAR', difficulty: 3 }],
  BAL: [{ week: 4, opp: '@KC', difficulty: 8 }, { week: 5, opp: 'CIN', difficulty: 6 }, { week: 6, opp: '@WAS', difficulty: 5 }],
  DET: [{ week: 4, opp: 'SEA', difficulty: 6 }, { week: 5, opp: '@MIN', difficulty: 7 }, { week: 6, opp: 'CIN', difficulty: 6 }],
  KC: [{ week: 4, opp: 'BAL', difficulty: 7 }, { week: 5, opp: '@JAX', difficulty: 5 }, { week: 6, opp: 'DET', difficulty: 6 }],
  HOU: [{ week: 4, opp: '@PIT', difficulty: 7 }, { week: 5, opp: 'IND', difficulty: 5 }, { week: 6, opp: '@GB', difficulty: 7 }],
  NYG: [{ week: 4, opp: 'DAL', difficulty: 6 }, { week: 5, opp: '@SEA', difficulty: 7 }, { week: 6, opp: 'PHI', difficulty: 8 }],
  NYJ: [{ week: 4, opp: '@MIA', difficulty: 5 }, { week: 5, opp: 'DAL', difficulty: 6 }, { week: 6, opp: '@BUF', difficulty: 8 }],
  DAL: [{ week: 4, opp: '@NYG', difficulty: 5 }, { week: 5, opp: '@NYJ', difficulty: 5 }, { week: 6, opp: 'CAR', difficulty: 3 }],
  DEN: [{ week: 4, opp: '@NYJ', difficulty: 5 }, { week: 5, opp: 'PHI', difficulty: 8 }, { week: 6, opp: '@LV', difficulty: 4 }],
  NO: [{ week: 4, opp: 'ATL', difficulty: 5 }, { week: 5, opp: '@KC', difficulty: 8 }, { week: 6, opp: 'TB', difficulty: 6 }],
  CHI: [{ week: 4, opp: 'MIN', difficulty: 6 }, { week: 5, opp: '@LV', difficulty: 4 }, { week: 6, opp: '@JAX', difficulty: 5 }],
  LV: [{ week: 4, opp: 'CLE', difficulty: 5 }, { week: 5, opp: 'CHI', difficulty: 5 }, { week: 6, opp: 'DEN', difficulty: 5 }],
  ARI: [{ week: 4, opp: '@SF', difficulty: 8 }, { week: 5, opp: '@IND', difficulty: 5 }, { week: 6, opp: 'GB', difficulty: 7 }],
};

// A subset of demo leagues carry a trade deadline (others deliberately don't, so the UI
// exercises both the "deadline set" and "no deadline" paths). Days-from-now, resolved
// against the deterministic demo clock at read time.
const TRADE_DEADLINE_DAYS = { '64097': 16, '19622': 41 };

module.exports = {
  players: () => PLAYERS,
  tradeDeadline: (leagueId) => {
    const days = TRADE_DEADLINE_DAYS[String(leagueId)];
    return days == null ? null : new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  },
  playerStatus: () => ({ ...PLAYER_STATUS }),
  byes: () => ({ ...BYES }),
  matchupProjection: (leagueId) => (MATCHUP_PROJECTION[leagueId] ? { ...MATCHUP_PROJECTION[leagueId] } : null),
  leagues: () => LEAGUES.map((l) => ({ ...l })),
  dashboard: (leagueId) => DASHBOARD[leagueId] || null,
  standings: (leagueId) => demoStandings(leagueId),
  playoffBrackets: (leagueId) => demoPlayoffBrackets(leagueId),
  transactions: (leagueId) => JSON.parse(JSON.stringify(TRANSACTIONS[leagueId] || [])),
  roster: (leagueId) => ROSTERS[leagueId] || null,
  teamStrength: (leagueId) => (TEAM_STRENGTH[leagueId] != null ? TEAM_STRENGTH[leagueId] : null),
  tradeBait: () => TRADE_BAIT.map((e) => ({ ...e })),
  tradeBaitBoard: (leagueId) => (TRADE_BAIT_BOARD[leagueId] || []).map((b) => ({ franchiseId: b.franchiseId, willGiveUp: [...b.willGiveUp] })),
  statProjections: () => ({ ...STAT_PROJECTIONS }),
  scoring: (leagueId) => (SCORING[leagueId] ? { ...SCORING[leagueId] } : null),
  lineupRequirements: (leagueId) => LINEUP_REQS[leagueId] || null,
  dynasty: (playerId) => DYNASTY[playerId] || null,
  live: (leagueId) => (LIVE[leagueId] ? JSON.parse(JSON.stringify(LIVE[leagueId])) : null),
  // Portfolio-friendly view (resolved names) for the Home triage.
  trades: (leagueId) =>
    (TRADE_OFFERS[leagueId] || []).map((o) => ({ id: o.id, from: o.withName, gives: o.acquire.map(assetLabel), gets: o.send.map(assetLabel) })),
  tradeOffers: (leagueId) => JSON.parse(JSON.stringify(TRADE_OFFERS[leagueId] || [])),
  tradePartners: (leagueId) => JSON.parse(JSON.stringify(TRADE_PARTNERS[leagueId] || [])),
  waivers: (leagueId) => (WAIVERS[leagueId] || []).map((w) => ({ ...w })),
  news: () => NEWS.map((n) => ({ ...n, published: new Date(Date.now() - (n.ageMins || 0) * 60000).toISOString() })),
  picks: (leagueId) => (PICKS[leagueId] || []).slice(),
  waiverSettings: (leagueId) => (WAIVER_SETTINGS[leagueId] ? { ...WAIVER_SETTINGS[leagueId] } : null),
  freeAgents: (leagueId) => (FREE_AGENTS[leagueId] || []).slice(),
  trend: (playerId) => TRENDS[playerId] || 0,
  draftYear: (playerId) => (DRAFT[playerId] && DRAFT[playerId].year) || DRAFT_YEARS[playerId] || null,
  draftInfo: (playerId) => (DRAFT[playerId] ? { year: DRAFT[playerId].year, round: DRAFT[playerId].round, pick: DRAFT[playerId].pick } : null),
  sleeperId: (playerId) => (DRAFT[playerId] && DRAFT[playerId].sleeperId) || null,
  ownership: (playerId) => (OWNERSHIP[playerId] != null ? OWNERSHIP[playerId] : 0),
  pendingClaims: (leagueId) => (PENDING_CLAIMS[leagueId] || []).map((c) => ({ ...c })),
  waiverResults: (leagueId) => (WAIVER_RESULTS[leagueId] || []).map((r) => ({ ...r })),
  gameLog: (playerId) => (GAME_LOG[playerId] || []).map((g) => ({ ...g })),
  priorSeason: (playerId) => {
    const s = PRIOR_SEASON[playerId];
    if (!s) return null;
    return {
      points: s.points,
      games: s.games,
      ppg: s.games ? Math.round((s.points / s.games) * 10) / 10 : null,
      stats: s.stats ? { passing: s.stats.passing || null, rushing: s.stats.rushing || null, receiving: s.stats.receiving || null } : null,
    };
  },
  schedule: (team) => (SCHEDULE[team] || []).map((s) => ({ ...s })),
  allPlayers: () => PLAYERS.map((p) => ({ ...p })),
  draftClass: () => DRAFT_CLASS.slice(),
  adp: () => ({ ...ADP }),
  draft: (leagueId) => (DRAFTS[leagueId] ? JSON.parse(JSON.stringify(DRAFTS[leagueId])) : null),
  week: () => WEEK,
};
