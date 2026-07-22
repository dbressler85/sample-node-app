'use strict';

// The "league" surface: the ordinary league-management views the app was missing —
// standings/records, and (to come) opponent rosters and a transaction feed. Read-only
// reads over MFL's league exports, one league at a time.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const mflRepo = require('../lib/mflRepo');
const leaguesService = require('./leagues');
const playersLib = require('../lib/players');
const picksLib = require('../lib/picks');
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round1 = (v) => Math.round((v || 0) * 10) / 10;
const record = (w, l, t) => `${w || 0}-${l || 0}${t > 0 ? `-${t}` : ''}`;

async function findLeague(cookie, leagueId) {
  const league = (await leaguesService.listLeagues(cookie)).find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  return league;
}

// Best-effort playoff-team count from league settings, so the standings can draw a
// playoff line. Field naming varies across MFL configs; null when we can't read it.
async function playoffSpotsFor(cookie, league) {
  try {
    const res = await mfl.exportRequest('league', { host: league.host, cookie, L: league.leagueId });
    const lg = (res && res.league) || {};
    const n = parseInt(lg.playoffTeams || lg.playoffs || lg.playoff_teams || '', 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    return null;
  }
}

// League standings: every franchise ranked, with W-L(-T), points for / against, and
// mine flagged. MFL's leagueStandings is already returned in standings order.
async function getStandings(cookie, leagueId) {
  const league = await findLeague(cookie, leagueId);

  let rows;
  let playoffSpots = null;
  if (config.demoMode) {
    rows = demo.standings(leagueId);
    playoffSpots = 6;
  } else {
    const [franchises, names, spots] = await Promise.all([
      mflRepo.standings(league, cookie),
      leaguesService.franchiseNames(cookie, league),
      playoffSpotsFor(cookie, league),
    ]);
    rows = franchises.map((f) => ({
      id: String(f.id),
      name: names.get(String(f.id)) || `Team ${f.id}`,
      mine: String(f.id) === league.franchiseId,
      h2hw: num(f.h2hw), h2hl: num(f.h2hl), h2ht: num(f.h2ht),
      pf: num(f.pf), pa: num(f.pa),
    }));
    playoffSpots = spots;
  }

  const standings = rows.map((r, i) => ({
    rank: i + 1,
    franchiseId: r.id,
    name: r.name,
    mine: !!r.mine,
    wins: r.h2hw || 0,
    losses: r.h2hl || 0,
    ties: r.h2ht || 0,
    record: record(r.h2hw, r.h2hl, r.h2ht),
    pointsFor: round1(r.pf),
    pointsAgainst: round1(r.pa),
    inPlayoffs: playoffSpots ? i < playoffSpots : null,
  }));

  return {
    leagueId: String(league.leagueId),
    name: league.name,
    playoffSpots,
    me: standings.find((s) => s.mine) || null,
    standings,
  };
}

// MFL roster status → a coarse slot for scouting (starter/bench isn't in the roster
// export — that's the separate lineup — so live only distinguishes IR / taxi / active).
function slotOf(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'INJURED_RESERVE') return 'ir';
  if (s === 'TAXI_SQUAD') return 'taxi';
  return 'active';
}

// Every franchise's roster in a league — opponent scouting. Players carry format-aware
// dynasty value; teams are sorted by total roster value, mine flagged. In demo we only
// model my roster + the trade-partner rosters (fixtures don't carry all 12 teams).
async function getTeams(cookie, leagueId) {
  const league = await findLeague(cookie, leagueId);
  const byId = await playersLib.load(cookie);
  const fmt = await leagueFormat.format(cookie, league);
  const [enr, names] = await Promise.all([
    enrichmentLib.snapshot(fmt, cookie),
    leaguesService.franchiseNames(cookie, league),
  ]);

  let franchises; // [{ franchiseId, name, mine, entries:[{id,status}] }]
  if (config.demoMode) {
    const r = demo.roster(leagueId) || { starters: [], bench: [], ir: [], taxi: [] };
    const mineEntries = [
      ...r.starters.map((id) => ({ id, status: 'ACTIVE' })),
      ...r.bench.map((id) => ({ id, status: 'ACTIVE' })),
      ...r.ir.map((id) => ({ id, status: 'INJURED_RESERVE' })),
      ...r.taxi.map((id) => ({ id, status: 'TAXI_SQUAD' })),
    ];
    franchises = [
      { franchiseId: league.franchiseId, name: league.franchiseName, mine: true, entries: mineEntries },
      ...demo.tradePartners(leagueId).map((p) => ({
        franchiseId: String(p.franchiseId), name: p.name, mine: false,
        entries: (p.roster || []).map((id) => ({ id: String(id), status: 'ACTIVE' })),
      })),
    ];
  } else {
    franchises = (await mflRepo.rosters(league, cookie)).map((f) => ({
      franchiseId: String(f.id),
      name: names.get(String(f.id)) || `Team ${f.id}`,
      mine: String(f.id) === league.franchiseId,
      entries: mfl.toArray(f.player).map((p) => ({ id: String(p.id), status: p.status || p.roster_status })),
    }));
  }

  const teams = franchises
    .map((f) => {
      const players = f.entries
        .map((e) => {
          const b = playersLib.resolve(byId, e.id);
          return { id: e.id, name: b.name, position: b.position, team: b.team, value: enr.value(e.id), slot: slotOf(e.status) };
        })
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      return {
        franchiseId: f.franchiseId,
        name: f.name,
        mine: !!f.mine,
        count: players.length,
        totalValue: Math.round(players.reduce((s, p) => s + (p.value || 0), 0)),
        players,
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue);

  return { leagueId: String(league.leagueId), name: league.name, format: leagueFormat.label(fmt), teams };
}

const TXN_LABEL = {
  TRADE: 'Trade', WAIVER: 'Waiver', BBID_WAIVER: 'Waiver (FAAB)', FREE_AGENT: 'Free agent',
  IR: 'IR move', TAXI: 'Taxi move', AUCTION_WON: 'Auction', AUCTION_INIT: 'Auction',
};
const toks = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

// Best-effort parse of MFL's transactions export into the raw shape getTransactions
// resolves. Add/drop types carry "added,|dropped,"; a TRADE carries the two sides'
// assets and the other franchise. Anything we can't parse still yields a typed row.
function parseLiveTransactions(list) {
  return (list || []).map((t, i) => {
    const type = String(t.type || '').toUpperCase();
    const payload = String(t.transaction || '');
    const base = { id: `${t.timestamp || 't'}:${i}`, type, at: num(t.timestamp), franchiseId: String(t.franchise || '') };
    if (type === 'TRADE') {
      const p = payload.split('|');
      return { ...base, withFranchiseId: p[2] ? String(p[2]).padStart(4, '0') : null, droppedIds: toks(p[0]), addedIds: toks(p[1]) };
    }
    const [added, dropped] = payload.split('|');
    return { ...base, addedIds: toks(added), droppedIds: toks(dropped) };
  });
}

// One recent-transactions feed for a league (newest first). Resolves player ids AND
// draft-pick tokens to readable names, and franchise ids to team names.
async function getTransactions(cookie, leagueId, { limit = 40 } = {}) {
  const league = await findLeague(cookie, leagueId);
  const byId = await playersLib.load(cookie);

  let raw;
  let names = new Map();
  if (config.demoMode) {
    raw = demo.transactions(leagueId);
  } else {
    const [txns, nm] = await Promise.all([
      mflRepo.transactions(league, cookie).catch(() => []),
      leaguesService.franchiseNames(cookie, league).catch(() => new Map()),
    ]);
    raw = parseLiveTransactions(txns);
    names = nm;
  }

  const asset = (id) => {
    const s = String(id);
    if (/^(FP_|DP_)/.test(s)) return { id: s, name: picksLib.labelForToken(s), position: 'PICK' };
    const b = playersLib.resolve(byId, s);
    return { id: s, name: b.name, position: b.position };
  };
  const franchise = (id, embeddedName) => (id ? { id: String(id), name: embeddedName || names.get(String(id)) || `Team ${id}` } : null);

  const transactions = raw.slice(0, limit).map((t) => ({
    id: t.id,
    type: t.type,
    typeLabel: TXN_LABEL[t.type] || (t.type ? t.type.replace(/_/g, ' ').toLowerCase() : 'Move'),
    at: t.at || null,
    franchise: franchise(t.franchiseId, t.franchiseName),
    withFranchise: franchise(t.withFranchiseId, t.withFranchiseName),
    added: (t.addedIds || []).map(asset),
    dropped: (t.droppedIds || []).map(asset),
  }));

  return { leagueId: String(league.leagueId), name: league.name, transactions };
}

module.exports = { getStandings, getTeams, getTransactions, findLeague };
