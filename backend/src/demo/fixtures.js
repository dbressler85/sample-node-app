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

// Per-league roster (ids into PLAYERS). starters/bench/ir/taxi.
const ROSTERS = {
  '64097': {
    starters: ['13116', '15267', '13649', '13593', '14802', '12171'],
    bench: ['15264', '13138', '11686'],
    ir: ['14106'],
    taxi: ['15266'],
  },
  '40750': {
    starters: ['14990', '15870', '14086', '15859', '15264', '14835'],
    bench: ['13593', '15266', '13138'],
    ir: [],
    taxi: ['15264'],
  },
  '19622': {
    starters: ['13116', '15267', '13649', '14802', '13138', '12171'],
    bench: ['14106', '11686'],
    ir: [],
    taxi: [],
  },
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
};

// Per-league scoring settings — deliberately different formats so the optimizer
// has to account for each: standard, superflex + 6pt passing TDs, and PPR with a
// tight-end premium.
const SCORING = {
  '64097': { ppr: 0, tePremium: 0, passTd: 4 }, // Dynasty Warlords — standard, 4pt PaTD
  '40750': { ppr: 1, tePremium: 0, passTd: 6 }, // Superflex Society — full PPR, 6pt PaTD
  '19622': { ppr: 1, tePremium: 0.5, passTd: 4 }, // Keeper Kings — full PPR + TE premium
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
};

// Live matchup detail for the current week: live points, players yet to play,
// and projected final for me and my opponent. Drives the live scoreboard.
const LIVE = {
  '64097': {
    me: { score: 78.4, yetToPlay: 3, projectedFinal: 121.6 },
    opp: { score: 84.1, yetToPlay: 2, projectedFinal: 118.0 },
  },
  '40750': {
    me: { score: 91.0, yetToPlay: 1, projectedFinal: 133.8 },
    opp: { score: 102.7, yetToPlay: 1, projectedFinal: 140.1 },
  },
  '19622': {
    me: { score: 55.2, yetToPlay: 6, projectedFinal: 118.9 },
    opp: { score: 60.8, yetToPlay: 5, projectedFinal: 121.0 },
  },
};

// Pending trade offers awaiting my response, per league.
const TRADES = {
  '40750': [
    { id: 't1', from: 'Superflex Savants', gives: ['Nix, Bo'], gets: ['Nabers, Malik'] },
  ],
  '19622': [
    { id: 't2', from: 'Rebuild Rangers', gives: ['2027 1st', '2027 2nd'], gets: ['Gibbs, Jahmyr'] },
  ],
};

// Pending waiver / FAAB claims I've queued, per league.
const WAIVERS = {
  '64097': [{ player: 'Cook, Dalvin', bid: 12, runsAt: 'Wed 3:00 AM' }],
};

// League-wide news, mapped to affected teams by whichever leagues roster the player.
const NEWS = [
  { id: 'n1', playerId: '15859', headline: 'Marvin Harrison ruled OUT (ankle)', severity: 'high' },
  { id: 'n2', playerId: '15267', headline: 'Bijan Robinson on bye this week', severity: 'medium' },
  { id: 'n3', playerId: '14802', headline: "Ja'Marr Chase questionable, expected to play", severity: 'low' },
  { id: 'n4', playerId: '13649', headline: 'Jahmyr Gibbs sees season-high snap share', severity: 'low' },
];

// Rookie / future draft pick inventory per league (dynasty currency).
const PICKS = {
  '64097': ['2027 1st', '2027 3rd'],
  '40750': ['2027 1st', '2027 2nd', '2028 1st'],
  '19622': ['2027 2nd'],
};

module.exports = {
  players: () => PLAYERS,
  playerStatus: () => ({ ...PLAYER_STATUS }),
  byes: () => ({ ...BYES }),
  matchupProjection: (leagueId) => (MATCHUP_PROJECTION[leagueId] ? { ...MATCHUP_PROJECTION[leagueId] } : null),
  leagues: () => LEAGUES.map((l) => ({ ...l })),
  dashboard: (leagueId) => DASHBOARD[leagueId] || null,
  roster: (leagueId) => ROSTERS[leagueId] || null,
  statProjections: () => ({ ...STAT_PROJECTIONS }),
  scoring: (leagueId) => (SCORING[leagueId] ? { ...SCORING[leagueId] } : null),
  lineupRequirements: (leagueId) => LINEUP_REQS[leagueId] || null,
  dynasty: (playerId) => DYNASTY[playerId] || null,
  live: (leagueId) => (LIVE[leagueId] ? JSON.parse(JSON.stringify(LIVE[leagueId])) : null),
  trades: (leagueId) => (TRADES[leagueId] || []).map((t) => ({ ...t })),
  waivers: (leagueId) => (WAIVERS[leagueId] || []).map((w) => ({ ...w })),
  news: () => NEWS.map((n) => ({ ...n })),
  picks: (leagueId) => (PICKS[leagueId] || []).slice(),
  week: () => WEEK,
};
