'use strict';

// Centralized trade-bait ("on the block") management. Flag players you're shopping in
// any league and see them all in one roll-up: value / age / availability, which league
// and roster slot they're in, your note (asking price / target), and a jump to that
// league's trade desk to shop them. A player you've since traded or dropped is flagged
// stale so you can clear it. Adding is guarded — you can only block a player you roster.

const config = require('../config');
const playersLib = require('../lib/players');
const enrichmentLib = require('../lib/enrichment');
const availabilityLib = require('../lib/availability');
const nflLib = require('../lib/nfl');
const demo = require('../demo/fixtures');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const baitStore = require('../store/tradebait');

async function ctxFor(cookie) {
  if (config.demoMode) return { week: demo.week(), statusMap: demo.playerStatus(), byeMap: demo.byes() };
  const week = await nflLib.currentWeek(cookie);
  const [statusMap, byeMap] = await Promise.all([nflLib.injuryMap(cookie, week), nflLib.byeMap(cookie, week)]);
  return { week, statusMap, byeMap };
}

// Which of my roster buckets holds this player (null = no longer mine → stale entry).
function bucketOf(roster, id) {
  if (!roster) return null;
  if (roster.starters.some((p) => p.id === id)) return 'starter';
  if (roster.bench.some((p) => p.id === id)) return 'bench';
  if (roster.ir.some((p) => p.id === id)) return 'ir';
  if (roster.taxi.some((p) => p.id === id)) return 'taxi';
  return null;
}

// The stored block for this token. In demo mode we seed an example block (until the
// user adds their own) so the feature isn't empty in the showcase.
function storedEntries(token) {
  const entries = baitStore.list(token);
  if (entries.length || !config.demoMode) return entries;
  return demo.tradeBait().map((e) => ({ leagueId: String(e.leagueId), playerId: String(e.playerId), note: e.note || null, at: 0 }));
}

async function getBlock(cookie, token) {
  const entries = storedEntries(token);
  if (!entries.length) return { leagues: [], totals: { count: 0, value: 0, leagues: 0 } };

  const allLeagues = await leaguesService.listLeagues(cookie);
  const leagueById = new Map(allLeagues.map((l) => [String(l.leagueId), l]));

  const byLeague = new Map();
  for (const e of entries) {
    if (!byLeague.has(e.leagueId)) byLeague.set(e.leagueId, []);
    byLeague.get(e.leagueId).push(e);
  }

  const [byId, enr, ctx] = await Promise.all([
    playersLib.load(cookie),
    enrichmentLib.snapshot(undefined, cookie),
    ctxFor(cookie),
  ]);

  const leagues = await Promise.all(
    [...byLeague.entries()].map(async ([leagueId, es]) => {
      const league = leagueById.get(String(leagueId));
      const roster = league ? await rosterService.getRoster(cookie, leagueId).catch(() => null) : null;
      const players = es
        .map((e) => {
          const base = playersLib.resolve(byId, e.playerId);
          const bucket = bucketOf(roster, String(e.playerId));
          return {
            id: base.id,
            name: base.name,
            position: base.position,
            team: base.team,
            value: enr.value(e.playerId),
            age: enr.age(e.playerId),
            availability: availabilityLib.resolve(base, ctx.statusMap, ctx.byeMap, ctx.week),
            note: e.note || null,
            bucket,
            // Only call it stale when we could actually read the roster and he's absent.
            stale: roster ? bucket === null : false,
          };
        })
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      return {
        leagueId: String(leagueId),
        name: league ? league.name : `League ${leagueId}`,
        players,
        count: players.length,
        value: Math.round(players.reduce((s, p) => s + (p.value || 0), 0)),
      };
    })
  );

  leagues.sort((a, b) => b.value - a.value);
  return {
    leagues,
    totals: {
      count: leagues.reduce((s, l) => s + l.count, 0),
      value: leagues.reduce((s, l) => s + l.value, 0),
      leagues: leagues.length,
    },
  };
}

// Player ids on the block in one league — lets a roster view mark them.
function leagueIds(token, leagueId) {
  return { ids: baitStore.listLeague(token, leagueId) };
}

async function add(cookie, token, leagueId, playerId, note) {
  // You can only shop a player you actually roster. Best-effort: if we can't read the
  // roster (transient), allow it rather than blocking a legitimate add.
  let owns = true;
  try {
    const roster = await rosterService.getRoster(cookie, leagueId);
    const all = [...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi];
    owns = all.some((p) => p.id === String(playerId));
  } catch (e) {
    owns = true;
  }
  if (!owns) {
    const err = new Error('You can only put a player you roster on the block.');
    err.status = 400;
    throw err;
  }
  baitStore.add(token, leagueId, playerId, note);
  return { ok: true, onBlock: true, leagueId: String(leagueId), id: String(playerId) };
}

function remove(token, leagueId, playerId) {
  baitStore.remove(token, leagueId, playerId);
  return { ok: true, onBlock: false, leagueId: String(leagueId), id: String(playerId) };
}

module.exports = { getBlock, leagueIds, add, remove };
