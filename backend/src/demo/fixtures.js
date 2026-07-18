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

// Projected points for the current week, keyed by player id. Deterministic so the
// optimizer produces stable, reviewable results in demo mode.
const PROJECTIONS = {
  '13593': 19.5, // Jefferson WR
  '14802': 21.0, // Chase WR
  '15267': 18.0, // Bijan RB
  '15859': 14.5, // Harrison WR
  '13116': 24.0, // Lamar QB
  '14086': 16.5, // Hall RB
  '15264': 15.0, // Nabers WR
  '12171': 12.5, // Kelce TE
  '14990': 18.5, // Stroud QB
  '15870': 16.0, // Nix QB
  '14106': 13.5, // Olave WR
  '13649': 17.5, // Gibbs RB
  '14835': 11.5, // Bowers TE
  '11686': 8.0, // Cook RB
  '15266': 12.0, // Odunze WR
  '13138': 13.0, // London WR
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

module.exports = {
  players: () => PLAYERS,
  leagues: () => LEAGUES.map((l) => ({ ...l })),
  dashboard: (leagueId) => DASHBOARD[leagueId] || null,
  roster: (leagueId) => ROSTERS[leagueId] || null,
  projections: () => ({ ...PROJECTIONS }),
  lineupRequirements: (leagueId) => LINEUP_REQS[leagueId] || null,
  week: () => WEEK,
};
