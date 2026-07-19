'use strict';

// Trades (M5). View incoming offers across leagues with dynasty-value analysis,
// accept/reject them, and propose new trades to other franchises. Values come
// from the format-aware enrichment layer, so "who wins" respects each league's
// superflex/PPR settings. MFL is the system of record in live (pendingTrades +
// import tradeResponse/tradeProposal); demo uses a seeded in-memory store.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');
const playersLib = require('../lib/players');
const picksLib = require('../lib/picks');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const tradeStore = require('../store/trades');

// Estimated dynasty value (0-100 scale) for a future draft pick. This is a
// model, not a market price: a round-based baseline plus a dynasty time-value
// discount for picks further out (a 1st two years away is worth less than this
// year's). Pick slot isn't known for future picks, so round is the best signal.
const PICK_VALUE_BY_ROUND = { 1: 55, 2: 28, 3: 14, 4: 7 };
function pickValue(label) {
  const s = String(label);
  const rm = /(\d+)\s*(?:st|nd|rd|th)/i.exec(s);
  const round = rm ? parseInt(rm[1], 10) : 4;
  let base = PICK_VALUE_BY_ROUND[round] != null ? PICK_VALUE_BY_ROUND[round] : Math.max(3, 8 - round);
  const ym = /(20\d{2})/.exec(s);
  if (ym) {
    const yearsOut = parseInt(ym[1], 10) - (config.season || parseInt(ym[1], 10));
    if (yearsOut > 0) base = Math.round(base * Math.pow(0.88, Math.min(yearsOut, 4))); // ~12%/yr
  }
  return Math.max(2, base);
}

// Resolve an asset token to a display object + value. A token is a player id, a
// demo 'pick:LABEL', or a live MFL future-pick token 'FP_<orig>_<year>_<round>'.
function asset(tok, byId, enr) {
  const t = String(tok);
  if (t.startsWith('pick:') || t.startsWith('FP_')) {
    const label = t.startsWith('pick:') ? t.slice(5) : picksLib.labelForToken(t);
    return { kind: 'pick', id: t, name: label, position: 'PICK', team: null, value: pickValue(label) };
  }
  const p = playersLib.resolve(byId, t);
  return { kind: 'player', id: p.id, name: p.name, position: p.position, team: p.team, value: enr.value(p.id) };
}

// Value analysis for one side vs the other (from my perspective).
function analyze(acquire, send) {
  const sum = (arr) => Math.round(arr.reduce((s, a) => s + (a.value || 0), 0) * 10) / 10;
  const acquireValue = sum(acquire);
  const sendValue = sum(send);
  const net = Math.round((acquireValue - sendValue) * 10) / 10;
  const scale = Math.max(acquireValue, sendValue, 1);
  const ratio = net / scale;
  let verdict = 'fair';
  if (net > 5 && ratio > 0.12) verdict = 'favorable';
  else if (net < -5 && ratio < -0.12) verdict = 'unfavorable';
  // estimated: the values are model estimates (enrichment dynasty values + a
  // pick model), and the verdict thresholds are heuristic — the UI marks it so.
  return { acquireValue, sendValue, net, verdict, estimated: true };
}

// Shape one raw offer ({acquire:[tok], send:[tok], ...}) into a full view.
function buildOffer(raw, league, byId, enr) {
  const acquire = (raw.acquire || []).map((t) => asset(t, byId, enr));
  const send = (raw.send || []).map((t) => asset(t, byId, enr));
  return {
    id: raw.id,
    leagueId: league.leagueId,
    leagueName: league.name,
    direction: raw.direction || 'incoming',
    status: raw.status || 'pending',
    withFranchiseId: raw.withFranchiseId || null,
    withName: raw.withName || 'Another team',
    acquire,
    send,
    analysis: analyze(acquire, send),
  };
}

// --- live helpers -----------------------------------------------------------

async function livePendingOffers(cookie, league) {
  try {
    const res = await mfl.exportRequest('pendingTrades', { host: league.host, cookie, L: league.leagueId, FRANCHISE: league.franchiseId });
    const list = mfl.toArray(res && res.pendingTrades && res.pendingTrades.pendingTrade);
    if (!list.length) return [];
    const names = await leaguesService.franchiseNames(cookie, league);
    const toks = (v) => String(v || '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    return list
      .filter((tr) => String(tr.offeredto != null ? tr.offeredto : tr.offeredTo) === league.franchiseId)
      .map((tr, i) => {
        const from = String(tr.offeringteam != null ? tr.offeringteam : tr.offeringTeam);
        return {
          id: String(tr.trade_id || tr.id || i),
          direction: 'incoming',
          status: 'pending',
          withFranchiseId: from,
          withName: names.get(from) || 'Another team',
          acquire: toks(tr.willGiveUp != null ? tr.willGiveUp : tr.will_give_up),
          send: toks(tr.willReceiveInReturn != null ? tr.willReceiveInReturn : tr.willReceive),
        };
      });
  } catch (e) {
    return [];
  }
}

async function liveRosters(cookie, league) {
  try {
    const res = await mfl.exportRequest('rosters', { host: league.host, cookie, L: league.leagueId });
    const franchises = mfl.toArray(res && res.rosters && res.rosters.franchise);
    const names = await leaguesService.franchiseNames(cookie, league);
    return franchises
      .filter((f) => String(f.id) !== league.franchiseId)
      .map((f) => ({
        franchiseId: String(f.id),
        name: names.get(String(f.id)) || `Team ${f.id}`,
        roster: mfl.toArray(f.player)
          .filter((p) => {
            const s = p.status || p.roster_status;
            return s !== 'INJURED_RESERVE' && s !== 'TAXI_SQUAD';
          })
          .map((p) => String(p.id)),
      }));
  } catch (e) {
    return [];
  }
}

// Pending offers for one league (seeded store in demo; MFL in live).
async function offersForLeague(cookie, token, league, byId, enr) {
  const raw = config.demoMode
    ? tradeStore.list(token, league.leagueId, demo.tradeOffers(league.leagueId))
    : await livePendingOffers(cookie, league);
  return raw.filter((o) => (o.status || 'pending') === 'pending').map((o) => buildOffer(o, league, byId, enr));
}

// --- public API -------------------------------------------------------------

async function findLeague(cookie, leagueId) {
  const league = (await leaguesService.listLeagues(cookie)).find((l) => l.leagueId === String(leagueId));
  if (!league) {
    const err = new Error(`League ${leagueId} not found for this account`);
    err.status = 404;
    throw err;
  }
  return league;
}

// All pending incoming offers across every league, value-analyzed.
async function getOverview(cookie, token) {
  const leagues = await leaguesService.listLeagues(cookie);
  const byId = await playersLib.load(cookie);
  const groups = await Promise.all(
    leagues.map(async (league) => {
      try {
        const enr = await enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie);
        return await offersForLeague(cookie, token, league, byId, enr);
      } catch (e) {
        return [];
      }
    })
  );
  const offers = groups.flat().filter((o) => o.direction === 'incoming');
  return {
    offers,
    summary: {
      count: offers.length,
      favorable: offers.filter((o) => o.analysis.verdict === 'favorable').length,
    },
  };
}

// One league's offers + everything needed to build a proposal.
async function getLeague(cookie, token, leagueId) {
  const league = await findLeague(cookie, leagueId);
  const byId = await playersLib.load(cookie);
  const enr = await enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie);

  const [offers, roster, rawPartners] = await Promise.all([
    offersForLeague(cookie, token, league, byId, enr),
    rosterService.getRoster(cookie, leagueId),
    config.demoMode ? Promise.resolve(demo.tradePartners(leagueId)) : liveRosters(cookie, league),
  ]);

  const myPlayers = [...roster.starters, ...roster.bench]
    .map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, value: enr.value(p.id) }))
    .sort((a, b) => (b.value || 0) - (a.value || 0));
  // Picks carry the real MFL trade token as their id, so a proposal can include them.
  const myPicks = (await picksLib.franchisePicks(cookie, league)).map((p) => asset(p.token, byId, enr));

  const partners = rawPartners.map((pt) => ({
    franchiseId: pt.franchiseId,
    name: pt.name,
    players: (pt.roster || [])
      .map((id) => asset(id, byId, enr))
      .sort((a, b) => (b.value || 0) - (a.value || 0)),
  }));

  return { leagueId: league.leagueId, name: league.name, offers, myPlayers, myPicks, partners };
}

// Accept or reject a pending incoming offer.
async function respond(cookie, token, leagueId, tradeId, action) {
  const act = action === 'accept' ? 'accept' : 'reject';
  const league = await findLeague(cookie, leagueId);
  if (!config.demoMode) {
    try {
      await mfl.importRequest('tradeResponse', { host: league.host, cookie, L: league.leagueId, FRANCHISE: league.franchiseId, TRADE_ID: tradeId, RESPONSE: act });
    } catch (e) {
      const err = new Error(`MFL rejected the trade response: ${e.message}`);
      err.status = 502;
      throw err;
    }
  }
  const seed = config.demoMode ? demo.tradeOffers(leagueId) : [];
  tradeStore.resolve(token, leagueId, seed, tradeId, act === 'accept' ? 'accepted' : 'rejected');
  return { ok: true, tradeId: String(tradeId), action: act };
}

// Propose a trade to another franchise. give/receive are asset tokens.
async function propose(cookie, token, leagueId, payload) {
  const league = await findLeague(cookie, leagueId);
  const give = (payload.give || []).map(String);
  const receive = (payload.receive || []).map(String);
  const toFranchiseId = String(payload.toFranchiseId || '');
  if (!toFranchiseId) throwBad('Pick a team to trade with.');
  if (!give.length || !receive.length) throwBad('Add at least one player or pick on each side.');

  if (!config.demoMode) {
    // Players are numeric ids and future picks are real MFL FP_ tokens — both are
    // valid in a proposal. Only demo 'pick:' labels (never present in live) drop.
    const valid = (t) => !t.startsWith('pick:');
    const giveIds = give.filter(valid);
    const recvIds = receive.filter(valid);
    try {
      await mfl.importRequest('tradeProposal', {
        host: league.host,
        cookie,
        L: league.leagueId,
        FRANCHISE: league.franchiseId,
        OFFEREDTO: toFranchiseId,
        WILL_GIVE_UP: giveIds.join(','),
        WILL_RECEIVE: recvIds.join(','),
        COMMENTS: payload.comments || '',
      });
    } catch (e) {
      const err = new Error(`MFL rejected the proposal: ${e.message}`);
      err.status = 502;
      throw err;
    }
  }

  const byId = await playersLib.load(cookie);
  const enr = await enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie);
  const withName = config.demoMode
    ? (demo.tradePartners(leagueId).find((p) => p.franchiseId === toFranchiseId) || {}).name || 'Another team'
    : (await leaguesService.franchiseNames(cookie, league)).get(toFranchiseId) || 'Another team';
  const stored = tradeStore.add(token, leagueId, config.demoMode ? demo.tradeOffers(leagueId) : [], {
    direction: 'outgoing',
    status: 'sent',
    withFranchiseId: toFranchiseId,
    withName,
    acquire: receive,
    send: give,
  });
  return { ok: true, offer: buildOffer(stored, league, byId, enr) };
}

function throwBad(msg) {
  const err = new Error(msg);
  err.status = 400;
  throw err;
}

module.exports = { getOverview, getLeague, respond, propose, analyze };
