'use strict';

// Centralized trade-bait ("on the block") management. Flag players you're shopping in
// any league and see them all in one roll-up: value / age / availability, which league
// and roster slot they're in, your note (asking price / target), and a jump to that
// league's trade desk to shop them. A player you've since traded or dropped is flagged
// stale so you can clear it. Adding is guarded — you can only block a player you roster.

const config = require('../config');
const mfl = require('../lib/mfl');
const mflRepo = require('../lib/mflRepo');
const playersLib = require('../lib/players');
const picksLib = require('../lib/picks');
const enrichmentLib = require('../lib/enrichment');
const availabilityLib = require('../lib/availability');
const nflLib = require('../lib/nfl');
const demo = require('../demo/fixtures');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const leagueContext = require('../lib/leagueContext');
const baitStore = require('../store/tradebait');
const playerTags = require('../store/playerTags');
const watchlist = require('../store/watchlist');

// Stamp a player asset with MY personal signals — Target/Avoid tag and whether he's on my watchlist —
// so every trade-bait row (mine AND rivals') shows my read at a glance. Picks carry nothing. `token`
// is the signed-in owner; conviction/watch are player-level and global across leagues.
function stampSignals(asset, token) {
  if (asset && asset.kind === 'player') {
    asset.tag = playerTags.get(token, asset.id) || null;
    asset.watched = watchlist.has(token, asset.id);
  }
  return asset;
}

// Split a bait row's `willGiveUp` (a CSV mixing player ids and pick tokens) into tokens.
// Confirmed against a live tradeBait sample: e.g. "16593,15721,DP_0_2,FP_0011_2027_1".
function baitTokens(bait) {
  return mfl.text(mfl.attr(bait, 'willGiveUp', 'will_give_up'))
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Resolve one bait token to a display asset — a rostered PLAYER (numeric id) or a draft PICK
// (FP_/DP_ token), valued the same way the trade desk values them (picksLib for picks).
function baitAsset(token, byId, enr) {
  if (/^\d+$/.test(token)) {
    const base = playersLib.resolve(byId, token);
    return { id: token, kind: 'player', name: base.name, position: base.position, team: base.team, value: enr.value(token), age: enr.age(token) };
  }
  const label = picksLib.labelForToken(token);
  return { id: token, kind: 'pick', name: label, position: 'PICK', team: null, value: picksLib.value(label), age: null };
}

// Display order for trade-bait assets: players by position (QB→RB→WR→TE→…), ties by value, then
// draft picks at the end (by value). Used everywhere bait is listed — mine and rivals'.
const POS_RANK = { QB: 0, RB: 1, WR: 2, TE: 3, PK: 4, K: 4, PN: 5, DEF: 6, DL: 6, LB: 6, CB: 6, S: 6 };
function assetRank(a) {
  if (a.kind === 'pick') return 99;
  const r = POS_RANK[a.position];
  return r != null ? r : 50;
}
function sortAssets(assets) {
  return assets.slice().sort((a, b) => assetRank(a) - assetRank(b) || (b.value || 0) - (a.value || 0));
}

// My franchise's CURRENT bait on MFL for a league: { ids: [...tokens], note }. null on a read
// failure (so callers can decline to WRITE and risk clobbering a set they couldn't read).
async function mflBaitFor(cookie, league) {
  try {
    const baits = await mflRepo.tradeBaits(league, cookie, { INCLUDE_DRAFT_PICKS: 1 });
    const mine = baits.find((b) => mfl.text(mfl.attr(b, 'franchise_id', 'franchiseId')) === String(league.franchiseId));
    if (!mine) return { ids: [], note: '' };
    return { ids: baitTokens(mine), note: mfl.text(mfl.attr(mine, 'inExchangeFor', 'in_exchange_for')) };
  } catch (e) {
    return null;
  }
}

// Write the FULL bait set for my franchise back to MFL (MFL keeps one listing per franchise, so a
// write replaces the whole set). Preserves the asking-price note unless a new one is given.
async function writeBait(cookie, league, ids, note) {
  await mfl.importRequest('tradeBait', {
    host: league.host,
    cookie,
    L: league.leagueId,
    FRANCHISE: league.franchiseId,
    WILL_GIVE_UP: ids.join(','),
    IN_EXCHANGE_FOR: note || '',
  });
  mfl.invalidateLeague(cookie, league.leagueId); // so the next block read reflects the change
}

const NO_SUGGEST = new Set(['PK', 'DEF', 'K', '?']); // kickers/defenses: skip partner fits

// Which rival franchises would most want this player: those thin at his position (a
// need) or who'd upgrade their best there. Contenders (stronger rosters) break ties —
// they're likelier to pay for a win-now piece. A heuristic, labeled as such in the UI.
function suggestPartners(franchises, player) {
  if (!player.position || NO_SUGGEST.has(player.position)) return [];
  const V = player.value || 0;
  const scored = franchises
    .filter((f) => !f.mine)
    .map((f) => {
      const ps = f.byPos[player.position] || { best: 0, depth: 0 };
      const upgrade = Math.max(0, V - ps.best); // how much he'd raise their best at the spot
      const thin = ps.depth <= 1;
      const interest = upgrade * 2 + (thin ? 25 : 0);
      let reason;
      if (ps.depth === 0) reason = `no ${player.position} of note`;
      else if (upgrade > 0) reason = `upgrades their ${player.position} (best ${ps.best})`;
      else if (thin) reason = `thin at ${player.position}`;
      else reason = `${player.position} depth`;
      return { franchiseId: f.franchiseId, name: f.name, reason, interest: Math.round(interest), totalValue: f.totalValue };
    })
    .filter((s) => s.interest > 0);
  scored.sort((a, b) => b.interest - a.interest || b.totalValue - a.totalValue);
  return scored.slice(0, 3).map(({ totalValue, interest, ...s }) => s);
}

async function findLeague(cookie, leagueId) {
  return (await leaguesService.listLeagues(cookie)).find((l) => l.leagueId === String(leagueId)) || null;
}

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

// MY trade block across leagues. Live: the AUTHORITATIVE source is MFL's own trade-bait listing
// (what actually shows to the rest of each league — including bait you set on the MFL site), read
// per league and merged with any not-yet-synced app additions. Demo keeps the local-store path so
// the showcase still works. Players carry roster/availability context + rival-fit suggestions;
// picks carry their dynasty value. Each league surfaces MFL's franchise-level asking-price note.
async function getBlock(cookie, token) {
  if (config.demoMode) return getBlockDemo(cookie, token);

  const allLeagues = await leaguesService.listLeagues(cookie);
  const [byId, enr, ctx] = await Promise.all([
    playersLib.load(cookie),
    enrichmentLib.snapshot(undefined, cookie),
    ctxFor(cookie),
  ]);

  // Phase 1 (parallel): read my MFL bait + local additions for every league; keep the ones with any.
  const scanned = await Promise.all(
    allLeagues.map(async (league) => {
      const mflBait = await mflBaitFor(cookie, league);
      const localEntries = baitStore.list(token).filter((e) => e.leagueId === String(league.leagueId));
      const tokens = [...new Set([...(mflBait ? mflBait.ids : []), ...localEntries.map((e) => String(e.playerId))])];
      if (!tokens.length) return null;
      return { league, tokens, note: (mflBait && mflBait.note) || null, localEntries };
    })
  );
  const active = scanned.filter(Boolean);

  // Phase 2 (parallel): only leagues with bait pay for a roster + franchise read.
  const leagues = await Promise.all(
    active.map(async ({ league, tokens, note, localEntries }) => {
      const [roster, franchises, context] = await Promise.all([
        rosterService.getRoster(cookie, league.leagueId).catch(() => null),
        rosterService.leagueFranchises(cookie, league.leagueId).catch(() => []),
        leagueContext.build(cookie, league).catch(() => null),
      ]);
      const noteById = new Map(localEntries.map((e) => [String(e.playerId), e.note]));
      const players = tokens
        .map((tok) => {
          const asset = baitAsset(tok, byId, enr);
          if (asset.kind === 'player') {
            asset.bucket = bucketOf(roster, asset.id);
            asset.availability = availabilityLib.resolve(playersLib.resolve(byId, asset.id), ctx.statusMap, ctx.byeMap, ctx.week);
            asset.stale = roster ? asset.bucket === null : false; // only "stale" when the roster read succeeded
            asset.note = noteById.get(asset.id) || null;
            asset.suggestions = suggestPartners(franchises, asset);
          } else {
            Object.assign(asset, { bucket: null, availability: null, stale: false, note: null, suggestions: [] });
          }
          return stampSignals(asset, token);
        })
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      // League scoring + starting lineup + my team's dynasty read — the context an owner needs when
      // deciding what to shop (a superflex league values a QB you'd never move in 1QB, etc.).
      const teamSummary = roster && roster.summary ? roster.summary : null;
      return {
        leagueId: String(league.leagueId),
        name: league.name,
        note,
        players,
        count: players.length,
        value: Math.round(players.reduce((s, p) => s + (p.value || 0), 0)),
        context: context
          ? { ...context, team: teamSummary ? { outlook: teamSummary.outlook || null, coreAge: teamSummary.coreAge != null ? teamSummary.coreAge : null, avgAge: teamSummary.avgAge != null ? teamSummary.avgAge : null, strengthLabel: teamSummary.strengthLabel || null } : null }
          : null,
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

// Demo path: the local store (seeded with an example block), no MFL reads.
async function getBlockDemo(cookie, token) {
  const entries = storedEntries(token);
  if (!entries.length) return { leagues: [], totals: { count: 0, value: 0, leagues: 0 } };
  const allLeagues = await leaguesService.listLeagues(cookie);
  const leagueById = new Map(allLeagues.map((l) => [String(l.leagueId), l]));
  const byLeague = new Map();
  for (const e of entries) {
    if (!byLeague.has(e.leagueId)) byLeague.set(e.leagueId, []);
    byLeague.get(e.leagueId).push(e);
  }
  const [byId, enr, ctx] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(undefined, cookie), ctxFor(cookie)]);
  const leagues = await Promise.all(
    [...byLeague.entries()].map(async ([leagueId, es]) => {
      const league = leagueById.get(String(leagueId));
      const [roster, franchises, context] = await Promise.all([
        league ? rosterService.getRoster(cookie, leagueId).catch(() => null) : null,
        league ? rosterService.leagueFranchises(cookie, leagueId).catch(() => []) : [],
        league ? leagueContext.build(cookie, league).catch(() => null) : null,
      ]);
      const players = es
        .map((e) => {
          const base = playersLib.resolve(byId, e.playerId);
          const bucket = bucketOf(roster, String(e.playerId));
          const player = {
            id: base.id, kind: 'player', name: base.name, position: base.position, team: base.team,
            value: enr.value(e.playerId), age: enr.age(e.playerId),
            availability: availabilityLib.resolve(base, ctx.statusMap, ctx.byeMap, ctx.week),
            note: e.note || null, bucket, stale: roster ? bucket === null : false,
          };
          player.suggestions = suggestPartners(franchises, player);
          return stampSignals(player, token);
        })
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      const teamSummary = roster && roster.summary ? roster.summary : null;
      return {
        leagueId: String(leagueId), name: league ? league.name : `League ${leagueId}`, note: null, players, count: players.length,
        value: Math.round(players.reduce((s, p) => s + (p.value || 0), 0)),
        context: context ? { ...context, team: teamSummary ? { outlook: teamSummary.outlook || null, coreAge: teamSummary.coreAge != null ? teamSummary.coreAge : null, avgAge: teamSummary.avgAge != null ? teamSummary.avgAge : null, strengthLabel: teamSummary.strengthLabel || null } : null } : null,
      };
    })
  );
  leagues.sort((a, b) => b.value - a.value);
  return { leagues, totals: { count: leagues.reduce((s, l) => s + l.count, 0), value: leagues.reduce((s, l) => s + l.value, 0), leagues: leagues.length } };
}

// The MARKET: what every OTHER franchise is shopping, across your leagues. Same MFL tradeBait read
// as getBlock, but the rows that aren't yours — resolved to team names + player/pick names + values
// so you can scan for targets. Live only (demo has no rival bait board).
async function getMarket(cookie, token) {
  if (config.demoMode) return { leagues: [], totals: { teams: 0, assets: 0, leagues: 0 } };
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const [byId, enr, ctx] = await Promise.all([playersLib.load(cookie), enrichmentLib.snapshot(undefined, cookie), ctxFor(cookie)]);

  const out = await Promise.all(
    leagues.map(async (league) => {
      const [baits, names, context] = await Promise.all([
        mflRepo.tradeBaits(league, cookie, { INCLUDE_DRAFT_PICKS: 1 }).catch(() => []),
        leaguesService.franchiseNames(cookie, league).catch(() => new Map()),
        leagueContext.build(cookie, league).catch(() => null),
      ]);
      const teams = baits
        .filter((b) => mfl.text(mfl.attr(b, 'franchise_id', 'franchiseId')) !== String(league.franchiseId))
        .map((b) => {
          const fid = mfl.text(mfl.attr(b, 'franchise_id', 'franchiseId'));
          const assets = sortAssets(
            baitTokens(b)
              .map((tok) => {
                const a = baitAsset(tok, byId, enr);
                // Injury/bye status for players (rivals' AND — via getBlock — yours), so a scan of a
                // rival's block shows who's actually deployable.
                if (a.kind === 'player') a.availability = availabilityLib.resolve(playersLib.resolve(byId, a.id), ctx.statusMap, ctx.byeMap, ctx.week);
                // My personal read on a rival's shopped player — is he a Target of mine? An Avoid? On
                // my watchlist? — so I can spot a rival dangling someone I want.
                return stampSignals(a, token);
              })
              .filter((a) => config.demoMode || a.kind === 'pick' || (a.name && !/^Player \d+$/.test(a.name)))
          );
          return {
            franchiseId: fid,
            name: names.get(fid) || `Team ${fid}`,
            note: mfl.text(mfl.attr(b, 'inExchangeFor', 'in_exchange_for')) || null,
            assets,
            count: assets.length,
            value: Math.round(assets.reduce((s, a) => s + (a.value || 0), 0)),
          };
        })
        .filter((t) => t.count)
        .sort((a, b) => b.value - a.value);
      return { leagueId: String(league.leagueId), name: league.name, teams, teamCount: teams.length, context };
    })
  );

  const leaguesWithBait = out.filter((l) => l.teamCount);
  return {
    leagues: leaguesWithBait,
    totals: {
      teams: leaguesWithBait.reduce((s, l) => s + l.teamCount, 0),
      assets: leaguesWithBait.reduce((s, l) => s + l.teams.reduce((ss, t) => ss + t.count, 0), 0),
      leagues: leaguesWithBait.length,
    },
  };
}

// Light per-league editor list for MANAGING your block: EVERY league (so you can add to any), each
// with its current bait token set + the one asking-price note. The full roster checklist itself is
// fetched lazily per league via the roster endpoint (which already carries value/age/availability) —
// this just says which of those are currently checked, and the note. Cheap: one bait read per league.
async function getBlockEditor(cookie, token) {
  const allLeagues = await leaguesService.listLeagues(cookie);
  const leagues = await Promise.all(
    allLeagues.map(async (league) => {
      let blockTokens = [];
      let note = '';
      if (config.demoMode) {
        blockTokens = baitStore.listLeague(token, league.leagueId).map(String);
        const entry = baitStore.list(token).find((e) => e.leagueId === String(league.leagueId) && e.note);
        note = entry ? entry.note : '';
      } else {
        const mine = await mflBaitFor(cookie, league);
        blockTokens = mine ? mine.ids : [];
        note = (mine && mine.note) || '';
      }
      // League scoring + starting lineup + my team read, so the primary bait-setting surface shows
      // what kind of league I'm shopping in (a QB is untouchable in superflex, a WR3 is depth in a
      // 4-WR league, etc.). Fail-soft.
      const context = await leagueContext.build(cookie, league).catch(() => null);
      return { leagueId: String(league.leagueId), name: league.name, note: note || '', blockTokens, count: blockTokens.length, context };
    })
  );
  // Leagues with bait first (most first), then the rest alphabetically.
  leagues.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  // My global player signals (Target/Avoid tags + watchlist), returned once so the client can mark
  // any roster row it renders — since tags/watch are player-level and league-independent.
  return {
    leagues,
    totals: { onBlock: leagues.reduce((s, l) => s + l.count, 0), leagues: leagues.length },
    signals: { tags: playerTags.all(token) || {}, watched: watchlist.list(token) || [] },
  };
}

// Save the WHOLE block for one league in one shot: `tokens` is the complete checked set (players +
// picks), `note` the single asking-price/target for the league. Replaces MFL's listing (which is one
// per franchise) and re-syncs the local mirror so on-block badges match.
async function saveBlock(cookie, token, leagueId, tokens, note) {
  const league = await findLeague(cookie, leagueId);
  const clean = [...new Set((Array.isArray(tokens) ? tokens : []).map(String).map((s) => s.trim()).filter(Boolean))];
  if (!config.demoMode) {
    if (!league) { const e = new Error('That league is not in your account.'); e.status = 404; throw e; }
    await writeBait(cookie, league, clean, note || '');
  }
  // Re-sync the local mirror (drives the ⇄ on-block badges) to exactly the saved set.
  const cleanSet = new Set(clean);
  for (const id of baitStore.listLeague(token, leagueId).map(String)) {
    if (!cleanSet.has(id)) baitStore.remove(token, leagueId, id);
  }
  for (const id of clean) baitStore.add(token, leagueId, id, note || null);
  return { ok: true, leagueId: String(leagueId), count: clean.length, note: note || '' };
}

// Player ids on the block in one league — lets a roster/players view mark them with the ⇄ badge.
// Reconciled with MFL's authoritative bait (players only) merged with local optimistic adds, so the
// badge lights up for bait set on the MFL site too — not just in-app. Fail-soft to the local mirror.
async function leagueIds(cookie, token, leagueId) {
  const local = baitStore.listLeague(token, leagueId).map(String);
  if (config.demoMode) return { ids: local };
  try {
    const league = await findLeague(cookie, leagueId);
    if (!league) return { ids: local };
    const mine = await mflBaitFor(cookie, league);
    if (!mine) return { ids: local };
    const players = mine.ids.filter((t) => /^\d+$/.test(t)); // player ids only (skip pick tokens)
    return { ids: [...new Set([...players, ...local])] };
  } catch (e) {
    return { ids: local };
  }
}

// Read-modify-write against MFL's bait so we NEVER clobber the rest of your listing (picks + other
// players + the asking-price note): read your current set, apply the one change, write it back.
async function add(cookie, token, leagueId, playerId, note) {
  const league = await findLeague(cookie, leagueId);
  const id = String(playerId);
  // You can only shop a player you actually roster. Best-effort: a transient roster read failure
  // doesn't block a legitimate add.
  let owns = true;
  try {
    const roster = await rosterService.getRoster(cookie, leagueId);
    const all = [...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi];
    owns = all.some((p) => p.id === id);
  } catch (e) {
    owns = true;
  }
  if (!owns) {
    const err = new Error('You can only put a player you roster on the block.');
    err.status = 400;
    throw err;
  }
  baitStore.add(token, leagueId, playerId, note); // optimistic local mirror (drives on-block badges)
  let synced = false;
  if (!config.demoMode && league) {
    const cur = await mflBaitFor(cookie, league);
    if (cur == null) {
      // Couldn't read the current set — writing now would wipe bait we can't see, so skip the push.
      console.log(`[tradebait] skipped MFL write for L=${leagueId} — current bait unreadable (won't risk clobbering it)`);
    } else if (!cur.ids.includes(id)) {
      try {
        await writeBait(cookie, league, [...cur.ids, id], cur.note || note || '');
        synced = true;
      } catch (e) {
        console.log(`[tradebait] MFL bait write failed for L=${leagueId}: ${mfl.errorDetail(e)}`);
      }
    } else {
      synced = true; // already on MFL's block
    }
  }
  return { ok: true, onBlock: true, leagueId: String(leagueId), id, synced };
}

async function remove(cookie, token, leagueId, playerId) {
  const league = await findLeague(cookie, leagueId);
  const id = String(playerId);
  baitStore.remove(token, leagueId, playerId);
  let synced = false;
  if (!config.demoMode && league) {
    const cur = await mflBaitFor(cookie, league);
    if (cur != null) {
      try {
        await writeBait(cookie, league, cur.ids.filter((t) => t !== id), cur.note);
        synced = true;
      } catch (e) {
        console.log(`[tradebait] MFL bait write failed for L=${leagueId}: ${mfl.errorDetail(e)}`);
      }
    }
  }
  return { ok: true, onBlock: false, leagueId: String(leagueId), id, synced };
}

module.exports = { getBlock, getBlockEditor, saveBlock, getMarket, leagueIds, add, remove };
