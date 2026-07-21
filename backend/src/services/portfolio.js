'use strict';

// The command-center home: a portfolio roll-up across every league plus a single
// triage queue of everything that needs the owner's attention.
//
// Two entry points:
//  - getHome:        computes the whole thing server-side (used as a fallback).
//  - getLeagueTriage: one league's contribution, so the app can load leagues
//                     progressively and paint as each arrives.
//
// Uses the lineup overview in "light" mode (no per-league projections / live
// scores) to keep MFL calls low when you have many leagues.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const picksLib = require('../lib/picks');
const playersLib = require('../lib/players');
const leaguesService = require('./leagues');
const lineupsService = require('./lineups');
const rosterService = require('./roster');
const nflLib = require('../lib/nfl');
const waiverStore = require('../store/waivers');
const playerTags = require('../store/playerTags');
const historyStore = require('../store/portfolioHistory');
const pvHistory = require('../store/playerValueHistory');
const tradebaitStore = require('../store/tradebait');
const tradebaitService = require('./tradebait');
const season = require('../lib/season');

const SEV = { high: 3, medium: 2, low: 1 };

// In the NFL offseason there are no games, so lineup triage is noise and the
// dashboard should pivot to dynasty concerns (value, outlook) + trades/waivers,
// which run all year. Phase is derived from whether there's an active week.
async function currentWeek(cookie) {
  return config.demoMode ? demo.week() : nflLib.currentWeek(cookie);
}
async function seasonPhase(cookie) {
  const w = await currentWeek(cookie);
  return w && w >= 1 && w <= 18 ? 'in_season' : 'offseason';
}

function dynastyOf(roster) {
  if (!roster || !roster.summary) return null;
  return { value: roster.summary.rosterValue, coreAge: roster.summary.coreAge, strengthPct: roster.summary.strengthPct, outlook: roster.summary.outlook };
}

// Pending trade offers awaiting my response. Live: MFL pendingTrades (best-effort
// — field names vary, so it's defensive and resolves ids to names where it can).
async function pendingTrades(cookie, league) {
  if (config.demoMode) return demo.trades(league.leagueId);
  try {
    const res = await mfl.exportRequest('pendingTrades', { host: league.host, cookie, L: league.leagueId, FRANCHISE: league.franchiseId });
    const list = mfl.toArray(res && res.pendingTrades && res.pendingTrades.pendingTrade);
    if (!list.length) return [];
    const [byId, names] = await Promise.all([playersLib.load(cookie), leaguesService.franchiseNames(cookie, league)]);
    const label = (tok) => {
      const t = String(tok).trim();
      if (!t) return null;
      if (/^\d+$/.test(t)) return playersLib.resolve(byId, t).name.split(',')[0];
      // FP_/DP_ pick tokens → a readable slot ("2027 1st", "2026 1.11").
      return picksLib.labelForToken(t);
    };
    const toks = (v) => String(v || '').split(/[,;|]/).map(label).filter(Boolean);
    return list
      .filter((tr) => String(mfl.attr(tr, 'offeredto')) === league.franchiseId)
      .map((tr, i) => ({
        id: String(mfl.attr(tr, 'trade_id', 'id') || i),
        from: names.get(String(mfl.attr(tr, 'offeringteam') || '')) || 'Another team',
        gives: toks(mfl.attr(tr, 'willgiveup')),
        gets: toks(mfl.attr(tr, 'willreceive', 'willreceiveinreturn')),
      }));
  } catch (e) {
    return [];
  }
}

// My pending waiver/FAAB claims. Live: from our claim store (what the app has
// submitted). Demo keeps its fixture.
function pendingWaivers(token, league) {
  if (config.demoMode) return demo.waivers(league.leagueId);
  return waiverStore
    .list(token, league.leagueId, [])
    .filter((c) => (c.status || 'pending') === 'pending')
    .map((c) => ({
      player: (c.add && c.add.name) || 'Player',
      bid: c.bid != null ? c.bid : null,
      runsAt: c.processTime || 'next run',
    }));
}

// The single lineup-derived triage item for a league (or null if it's fine).
function lineupItem(l) {
  if (l.error) return null;
  if (l.status === 'risk') {
    const who = (l.warnings || []).filter((w) => w.playerId).map((w) => `${w.name.split(',')[0]} (${w.status})`);
    return { id: `lineup-risk-${l.leagueId}`, type: 'lineup_risk', severity: 'high', action: 'lineup', leagueId: l.leagueId, leagueName: l.name, title: 'Unavailable player in your lineup', subtitle: who.join(', ') || 'A starter can’t play' };
  }
  if (l.status === 'incomplete') {
    return { id: `lineup-hole-${l.leagueId}`, type: 'lineup_incomplete', severity: 'high', action: 'waiver', leagueId: l.leagueId, leagueName: l.name, title: 'No eligible starter — needs a pickup', subtitle: 'A slot has no healthy player; hit the waiver wire' };
  }
  if (l.status === 'unset') {
    return { id: `lineup-unset-${l.leagueId}`, type: 'lineup_unset', severity: 'medium', action: 'lineup', leagueId: l.leagueId, leagueName: l.name, title: 'Lineup not set', subtitle: 'Set your starters for this week' };
  }
  if (l.status === 'suboptimal') {
    return { id: `lineup-sub-${l.leagueId}`, type: 'lineup_suboptimal', severity: 'medium', action: 'lineup', leagueId: l.leagueId, leagueName: l.name, title: 'A better lineup is available', subtitle: 'Optimize your starters' };
  }
  return null;
}

// Trade + waiver items for one league.
async function extraItems(cookie, token, league) {
  const items = [];
  for (const t of await pendingTrades(cookie, league)) {
    const detail = t.gives.length || t.gets.length ? `They give ${t.gives.join(', ') || '—'} for ${t.gets.join(', ') || '—'}` : 'Tap to review the offer';
    items.push({ id: `trade-${league.leagueId}-${t.id}`, type: 'trade_offer', severity: 'high', action: 'trade', leagueId: league.leagueId, leagueName: league.name, title: `Trade offer from ${t.from}`, subtitle: detail });
  }
  for (const w of pendingWaivers(token, league)) {
    items.push({ id: `waiver-${league.leagueId}-${w.player}`, type: 'waiver_pending', severity: 'low', action: 'waiver', leagueId: league.leagueId, leagueName: league.name, title: `Waiver claim pending: ${w.player.split(',')[0]}`, subtitle: `${w.bid != null ? `$${w.bid} · ` : ''}runs ${w.runsAt}` });
  }
  return items;
}

// One league's triage contribution, for progressive loading. In-season we lead
// with lineup status; in the offseason we skip it (no games) and attach a
// dynasty summary instead — so the per-league call count stays flat either way.
async function getLeagueTriage(cookie, token, leagueId) {
  const league = (await leaguesService.listLeagues(cookie)).find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  const phase = await seasonPhase(cookie);
  const items = [];
  let status = 'offseason';
  let dynasty = null;

  if (phase === 'in_season') {
    const l = await lineupsService.getStatus(cookie, token, leagueId, { light: true });
    status = l.status;
    const li = lineupItem(l);
    if (li) items.push(li);
  } else {
    dynasty = dynastyOf(await rosterService.getRoster(cookie, leagueId).catch(() => null));
  }

  items.push(...(await extraItems(cookie, token, league)));
  return { leagueId: league.leagueId, name: league.name, status, phase, dynasty, items };
}

async function getHome(cookie, token) {
  const phase = await seasonPhase(cookie);
  // All of the account's leagues, pinned first.
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const items = [];
  const counts = { injuries: 0, holes: 0, lineupsToSet: 0 };
  const teams = [];
  const dynastyList = [];

  if (phase === 'in_season') {
    // The lineup overview does its own league read; intersect it with the account's
    // leagues so a stale or foreign entry can't leak into triage.
    const visible = new Set(leagues.map((l) => String(l.leagueId)));
    const overview = await lineupsService.getOverview(cookie, token, 'auto', { light: true });
    for (const l of overview.leagues) {
      if (!visible.has(String(l.leagueId))) continue;
      if (l.status === 'risk') counts.injuries += 1;
      else if (l.status === 'incomplete') counts.holes += 1;
      else if (l.status === 'unset') counts.lineupsToSet += 1;
      const li = lineupItem(l);
      if (li) items.push(li);
    }
    teams.push(...leagues.map((l) => ({ leagueId: l.leagueId, name: l.name })));
  } else {
    // Offseason: no lineups — attach each team's dynasty summary instead.
    const rosters = await Promise.all(leagues.map((l) => rosterService.getRoster(cookie, l.leagueId).catch(() => null)));
    leagues.forEach((l, i) => {
      const dynasty = dynastyOf(rosters[i]);
      if (dynasty) dynastyList.push(dynasty);
      teams.push({ leagueId: l.leagueId, name: l.name, dynasty });
    });
  }

  let tradeOffers = 0;
  let waiversPending = 0;
  const extra = await Promise.all(leagues.map((league) => extraItems(cookie, token, league)));
  for (const ex of extra) {
    tradeOffers += ex.filter((i) => i.type === 'trade_offer').length;
    waiversPending += ex.filter((i) => i.type === 'waiver_pending').length;
    items.push(...ex);
  }

  items.sort((a, b) => (SEV[b.severity] || 0) - (SEV[a.severity] || 0));

  const coreAges = dynastyList.map((d) => d.coreAge).filter((a) => a != null);
  return {
    phase,
    week: await currentWeek(cookie),
    portfolio: {
      leagues: leagues.length,
      needAttention: phase === 'in_season' ? counts.injuries + counts.holes + counts.lineupsToSet : items.length,
      injuries: counts.injuries,
      holes: counts.holes,
      lineupsToSet: counts.lineupsToSet,
      tradeOffers,
      waiversPending,
      // Dynasty rollup (offseason): total asset value + avg core age + outlook mix.
      rosterValue: dynastyList.reduce((s, d) => s + (d.value || 0), 0),
      avgCoreAge: coreAges.length ? Math.round((coreAges.reduce((s, a) => s + a, 0) / coreAges.length) * 10) / 10 : null,
      contenders: dynastyList.filter((d) => d.outlook === 'Win-now window').length,
      ascending: dynastyList.filter((d) => d.outlook === 'Ascending').length,
      rebuilding: dynastyList.filter((d) => d.outlook === 'Rebuilding').length,
      balanced: dynastyList.filter((d) => d.outlook === 'Balanced').length,
      actionItems: items.length,
    },
    teams,
    triage: items,
  };
}

// --- portfolio dashboard (dynasty value + value-at-risk) --------------------

// Age at which a position's dynasty value typically starts declining — the point
// past which rostered value is "aging" (at risk of falling). Position-aware
// because an RB ages out years before a QB.
const DECLINE_AGE = { QB: 32, RB: 27, WR: 29, TE: 30, PK: 34, DEF: 99 };
function isAging(position, age) {
  if (age == null) return false;
  const cliff = DECLINE_AGE[position] != null ? DECLINE_AGE[position] : 29;
  return age >= cliff;
}

// Age bands for the "where is my value concentrated" curve.
const AGE_BANDS = [
  [0, 23, '≤23'],
  [24, 25, '24–25'],
  [26, 27, '26–27'],
  [28, 29, '28–29'],
  [30, 120, '30+'],
];
function ageBand(age) {
  if (age == null) return null;
  const b = AGE_BANDS.find(([min, max]) => age >= min && age <= max);
  return b ? b[2] : null;
}

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// Cross-league dynasty portfolio: total invested value, how it's distributed by
// age, and the value "at risk" — tied up in players who are hurt (can't be
// deployed now) or aging past their position's decline curve. Each roster spot
// counts, so a player you hold in three leagues counts three times (that IS your
// portfolio exposure). Reuses the enriched rosters (value + age + availability).
async function getDashboard(cookie, token) {
  // The leagues-list read is the one call here that isn't already best-effort — a
  // transient MFL error on it used to 502 the whole Portfolio. Retry once; the
  // per-league roster reads below already degrade to null individually.
  let leagues;
  try {
    leagues = await leaguesService.orderedLeagues(cookie, token);
  } catch (e) {
    leagues = await leaguesService.orderedLeagues(cookie, token).catch(() => {
      const err = new Error('Couldn’t load your leagues just now — pull to refresh.');
      err.status = 503;
      throw err;
    });
  }
  // Pinned leagues sort first in the per-league breakdown (muting is a Home/On Deck/exposure concern).
  // Resolve NFL byes (team → week) alongside the rosters, best-effort, for bye-week concentration.
  const [loaded, byeMap] = await Promise.all([
    Promise.all(
      leagues.map((l) => rosterService.getRoster(cookie, l.leagueId).then((roster) => ({ league: l, roster })).catch(() => null))
    ),
    (config.demoMode ? Promise.resolve(demo.byes()) : currentWeek(cookie).then((w) => nflLib.byeMap(cookie, w))).catch(() => ({})),
  ]);
  const valid = loaded.filter(Boolean);

  let totalValue = 0;
  let playerCount = 0;
  let ageValueSum = 0; // value-weighted age numerator
  let ageValueWeight = 0;
  const curve = new Map(AGE_BANDS.map(([, , label]) => [label, { band: label, value: 0, count: 0 }]));
  const injured = [];
  const aging = [];
  const riskIds = new Set(); // distinct (league,player) keys counted once toward total-at-risk
  let riskValue = 0;
  const byLeague = [];
  const outlookMix = { winNow: 0, ascending: 0, rebuilding: 0, balanced: 0 };
  // Your positions, stock-portfolio style: each PLAYER aggregated across every league you hold
  // him in (that total value is your real exposure), and value grouped by position (allocation).
  const holdMap = new Map(); // playerId -> { id, name, position, team, total, leagues, top }
  const allocMap = new Map(); // position -> value
  const teamMap = new Map(); // NFL team -> value (stack/team concentration)
  const byeMapAgg = new Map(); // bye week -> value (bye-week concentration: a rough week where many starters sit)
  // Distinct rostered players you've tagged — "shop your Avoids" / "your Targets are safe".
  const tags = playerTags.all(token);
  const taggedRostered = { target: new Set(), avoid: new Set() };

  for (const { league, roster } of valid) {
    const all = [...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi];
    let leagueRisk = 0;
    for (const p of all) {
      const t = tags[String(p.id)];
      if (t === 'avoid') taggedRostered.avoid.add(String(p.id));
      else if (t === 'target') taggedRostered.target.add(String(p.id));
      const v = p.value || 0;
      if (!v) continue;
      totalValue += v;
      playerCount += 1;
      // Aggregate this player across leagues into a single holding (position).
      const h = holdMap.get(p.id) || { id: p.id, name: p.name, position: p.position, team: p.team, total: 0, leagues: 0, top: 0, leagueIds: [] };
      h.total += v; h.leagues += 1; if (v > h.top) h.top = v;
      h.leagueIds.push(league.leagueId);
      holdMap.set(p.id, h);
      allocMap.set(p.position, (allocMap.get(p.position) || 0) + v);
      if (p.team) teamMap.set(p.team, (teamMap.get(p.team) || 0) + v);
      const bye = byeMap[p.team];
      if (bye) byeMapAgg.set(bye, (byeMapAgg.get(bye) || 0) + v);
      if (p.age != null) {
        ageValueSum += p.age * v;
        ageValueWeight += v;
        const band = ageBand(p.age);
        if (band && curve.has(band)) { const c = curve.get(band); c.value += v; c.count += 1; }
      }
      const key = `${league.leagueId}:${p.id}`;
      // Hurt = can't be deployed now (OUT / IR / injured), excluding a plain bye.
      const hurt = p.availability && p.availability.startable === false && p.availability.status !== 'BYE';
      const old = isAging(p.position, p.age);
      const entry = { id: p.id, name: p.name, position: p.position, team: p.team, age: p.age, value: v, leagueId: league.leagueId, leagueName: league.name };
      if (hurt) injured.push({ ...entry, reason: p.availability.status });
      if (old) aging.push({ ...entry, reason: `age ${p.age}` });
      if (hurt || old) { if (!riskIds.has(key)) { riskIds.add(key); riskValue += v; leagueRisk += v; } }
    }
    const s = roster.summary || {};
    if (s.outlook === 'Win-now window') outlookMix.winNow += 1;
    else if (s.outlook === 'Ascending') outlookMix.ascending += 1;
    else if (s.outlook === 'Rebuilding') outlookMix.rebuilding += 1;
    else outlookMix.balanced += 1;
    byLeague.push({
      leagueId: league.leagueId,
      name: league.name,
      value: s.rosterValue != null ? Math.round(s.rosterValue) : null,
      coreAge: s.coreAge != null ? s.coreAge : null,
      strengthPct: s.strengthPct != null ? s.strengthPct : null,
      outlook: s.outlook || null,
      atRiskValue: Math.round(leagueRisk),
      atRiskPct: pct(leagueRisk, s.rosterValue || 0),
    });
  }

  const bySizeDesc = (a, b) => b.value - a.value;
  injured.sort(bySizeDesc);
  aging.sort(bySizeDesc);
  // Top single at-risk holdings (dedupe by name+league already distinct), biggest first.
  const top = [...injured, ...aging].sort(bySizeDesc).slice(0, 8);
  byLeague.sort((a, b) => (b.value || 0) - (a.value || 0));

  // Top holdings: your biggest positions by aggregate value across all leagues, with exposure
  // (how many of your leagues roster them) and what share of the whole portfolio each is.
  const holdings = [...holdMap.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)
    .map((h) => ({
      id: h.id, name: h.name, position: h.position, team: h.team,
      value: Math.round(h.total), leagues: h.leagues,
      avg: Math.round(h.total / h.leagues), pct: pct(h.total, totalValue),
      leagueIds: h.leagueIds,
      // Already shopping him anywhere? Drives the portfolio "Shop" toggle's state.
      baited: h.leagueIds.some((lid) => tradebaitStore.has(token, lid, h.id)),
    }));

  // Allocation by position — the "sectors" of the portfolio.
  const allocation = [...allocMap.entries()]
    .map(([position, value]) => ({ position, value: Math.round(value), pct: pct(value, totalValue) }))
    .sort((a, b) => b.value - a.value);

  // Concentration — the multi-league owner's stack risk. Value tied to a single NFL team
  // (a bad team season dents many rosters at once) and to a single bye week (a rough week
  // where a chunk of your starters all sit). Top few, biggest share first.
  const byTeam = [...teamMap.entries()]
    .map(([team, value]) => ({ team, value: Math.round(value), pct: pct(value, totalValue) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const byBye = [...byeMapAgg.entries()]
    .map(([week, value]) => ({ week: Number(week), value: Math.round(value), pct: pct(value, totalValue) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  // Per-holding movers: record each holding's value today, then rank by change vs the
  // earliest point we have — "which of your players rose/fell most." Demo seeds a mixed
  // synthetic history (some up, some down) the first time so movers aren't empty.
  const moverList = [];
  holdings.forEach((h, i) => {
    if (config.demoMode && pvHistory.series(token, h.id).length === 0 && h.value > 0) {
      pvHistory.seed(token, h.id, syntheticPlayerHistory(h.value, i));
    }
    const s = pvHistory.record(token, h.id, h.value);
    if (s.length >= 2) {
      const first = s[0].value;
      const delta = h.value - first;
      if (delta !== 0) {
        moverList.push({ id: h.id, name: h.name, position: h.position, value: h.value, delta, pct: first > 0 ? round1((delta / first) * 100) : 0 });
      }
    }
  });
  moverList.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const movers = moverList.slice(0, 6);

  // Value-over-time: record today's point and read back the series. Demo mode seeds a
  // synthetic ramp the first time so the sparkline isn't empty on a fresh account.
  const totalRounded = Math.round(totalValue);
  if (config.demoMode && historyStore.history(token).length === 0 && totalRounded > 0) {
    historyStore.seed(token, syntheticHistory(totalRounded));
  }
  const series = historyStore.record(token, totalRounded);
  const change = seriesChange(series);

  return {
    totals: {
      leagues: leagues.length,
      teams: valid.length,
      rosterValue: Math.round(totalValue),
      playerCount,
      valueWeightedAge: ageValueWeight > 0 ? round1(ageValueSum / ageValueWeight) : null,
    },
    ageCurve: AGE_BANDS.map(([, , label]) => {
      const c = curve.get(label);
      return { band: label, value: Math.round(c.value), count: c.count, pct: pct(c.value, totalValue) };
    }),
    atRisk: {
      injured: { value: Math.round(injured.reduce((s, p) => s + p.value, 0)), count: injured.length },
      aging: { value: Math.round(aging.reduce((s, p) => s + p.value, 0)), count: aging.length },
      totalValue: Math.round(riskValue),
      pct: pct(riskValue, totalValue),
      top,
    },
    outlookMix,
    tags: { avoids: taggedRostered.avoid.size, targets: taggedRostered.target.size },
    holdings,
    allocation,
    movers,
    concentration: { byTeam, byBye },
    seasonal: season.advisory(),
    history: series,
    change,
    byLeague,
  };
}

// Change over the recorded window: latest value vs the earliest point we have, as an
// absolute delta, a percentage, and how many days the window spans. Null until there are
// at least two points to compare.
function seriesChange(series) {
  if (!series || series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const abs = last.value - first.value;
  const days = Math.max(1, Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86400000));
  return { absolute: abs, pct: first.value > 0 ? round1((abs / first.value) * 100) : 0, days };
}

// A synthetic per-player history ending at `end` (today's value). The start factor varies by
// index so the demo shows a realistic MIX of gainers (started low) and losers (started high).
// Deterministic — no RNG, so resume/replay is stable.
function syntheticPlayerHistory(end, i, days = 14) {
  const factor = 0.82 + (((i * 7) % 9) * 0.045); // ~0.82 … 1.18 across holdings
  const start = Math.max(1, Math.round(end * factor));
  const out = [];
  const base = new Date();
  for (let d = days - 1; d >= 1; d -= 1) {
    const dt = new Date(base.getTime() - d * 86400000);
    const t = (days - 1 - d) / (days - 1);
    const val = Math.round(start + (end - start) * t + Math.sin(d * 0.8) * end * 0.01);
    out.push({ date: pvHistory.dayKey(dt), value: Math.max(1, val) });
  }
  return out; // today's real point is appended by record()
}

// A smooth synthetic value history ending at `end` (today's value), ramping up over ~30 days
// with a gentle wave, so the demo sparkline reads like a real portfolio. Deterministic.
function syntheticHistory(end, days = 30) {
  const start = Math.round(end * 0.84);
  const out = [];
  const base = new Date();
  for (let i = days - 1; i >= 1; i -= 1) {
    const d = new Date(base.getTime() - i * 86400000);
    const t = (days - 1 - i) / (days - 1); // 0 → ~1 across the window
    const ramp = start + (end - start) * t;
    const wave = Math.sin(i * 0.7) * end * 0.012; // ±1.2% ripple
    out.push({ date: historyStore.dayKey(d), value: Math.round(ramp + wave) });
  }
  return out; // today's real point is appended by the caller's record()
}

// Shop (or un-shop) a holding across every league you roster him in — the portfolio-native
// "I'm out on this asset everywhere" action. Fans the per-league trade-bait add/remove out
// (each is ownership-guarded and MFL-synced), best-effort so one league's failure doesn't
// sink the rest. Returns the new state + how many leagues actually took.
async function shopHolding(cookie, token, playerId, on, leagueIds) {
  const ids = Array.isArray(leagueIds) ? leagueIds.map(String) : [];
  if (!ids.length) {
    const err = new Error('No leagues given for this player.');
    err.status = 400;
    throw err;
  }
  const results = await Promise.all(
    ids.map((lid) =>
      (on ? tradebaitService.add(cookie, token, lid, playerId, null) : tradebaitService.remove(cookie, token, lid, playerId))
        .then(() => true)
        .catch(() => false)
    )
  );
  const changed = results.filter(Boolean).length;
  return { id: String(playerId), baited: !!on, leagues: changed, requested: ids.length };
}

module.exports = { getHome, getLeagueTriage, getDashboard, shopHolding };
