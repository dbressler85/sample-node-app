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
const playerTags = require('../store/playerTags');
const baitStore = require('../store/tradebait');
const tradefit = require('../lib/tradefit');

// Trade bait for every franchise in a league: my own from our store (or the demo seed),
// everyone else's from MFL's native Trade Bait board (or a demo fixture). Returns
// Map(franchiseId -> Set(playerId)). Best-effort — an unreadable board yields empty sets,
// and suggestions simply fall back to value + needs.
async function tradeBaitByFranchise(cookie, token, league) {
  const map = new Map();
  let mineIds = baitStore.listLeague(token, league.leagueId);
  if (!mineIds.length && config.demoMode) {
    mineIds = demo.tradeBait().filter((e) => String(e.leagueId) === String(league.leagueId)).map((e) => String(e.playerId));
  }
  map.set(String(league.franchiseId), new Set(mineIds.map(String)));

  if (config.demoMode) {
    for (const b of demo.tradeBaitBoard(league.leagueId)) map.set(String(b.franchiseId), new Set((b.willGiveUp || []).map(String)));
  } else {
    try {
      const res = await mfl.exportRequest('tradeBait', { host: league.host, cookie, L: league.leagueId });
      for (const b of mfl.toArray(res && res.tradeBaits && res.tradeBaits.tradeBait)) {
        const fid = String(b.franchise_id != null ? b.franchise_id : (b.franchiseId || ''));
        if (!fid) continue;
        const ids = String(b.willGiveUp || b.will_give_up || '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
        map.set(fid, new Set(ids));
      }
    } catch (e) {
      /* no board -> no bait signal */
    }
  }
  return map;
}

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

// Attach a roster-construction read (does this deal fix a hole or open one?) to each
// offer. `construction` is from MY side — I give `send`, I get `acquire`. For offers where
// the other team is known, `partnerConstruction` is the mirror from THEIR side — they give
// `acquire`, they get `send` — so an outgoing offer shows whether it also helps them (i.e.
// whether they're likely to bite).
function annotateConstruction(offers, ns, franchiseId) {
  const mine = ns[String(franchiseId)] || { needs: [], surplus: [], depth: {} };
  for (const o of offers) {
    o.construction = tradefit.constructionVerdict(o.send, o.acquire, mine.needs, mine.surplus, 'you', mine.depth);
    const theirs = o.withFranchiseId ? ns[String(o.withFranchiseId)] : null;
    if (theirs) o.partnerConstruction = tradefit.constructionVerdict(o.acquire, o.send, theirs.needs, theirs.surplus, 'they', theirs.depth);
  }
  return offers;
}

// Personal-value overlay from Target/Avoid tags. Market `analysis` stays untouched (it's
// the honest, partner-visible read); this is "for YOU" — the same math over tag-adjusted
// values (Target ×1.10, Avoid ×0.90). Only computed when a tagged player is involved.
function personalAnalyze(acquire, send) {
  if (![...acquire, ...send].some((a) => a.tag)) return null; // nothing tagged → no personal lens
  const scale = (arr) => arr.map((a) => ({ ...a, value: (a.value || 0) * playerTags.modifier(a.tag) }));
  return analyze(scale(acquire), scale(send));
}

// Short, human notes about the tagged players in a deal (from your perspective).
function tagNotes(acquire, send) {
  const notes = [];
  if (send.some((a) => a.tag === 'target')) notes.push({ level: 'caution', text: 'They want a Target of yours' });
  if (acquire.some((a) => a.tag === 'avoid')) notes.push({ level: 'caution', text: "You'd take on an Avoid" });
  if (acquire.some((a) => a.tag === 'target')) notes.push({ level: 'good', text: "You'd land a Target" });
  if (send.some((a) => a.tag === 'avoid')) notes.push({ level: 'good', text: 'Sheds an Avoid' });
  return notes;
}

// Stamp each player asset with its tag, then attach the personal analysis + notes.
function annotateTags(offers, token) {
  for (const o of offers) {
    for (const a of [...o.acquire, ...o.send]) if (a.kind !== 'pick') a.tag = playerTags.get(token, a.id) || null;
    o.personal = personalAnalyze(o.acquire, o.send); // null when nothing's tagged
    o.tagNotes = tagNotes(o.acquire, o.send);
  }
  return offers;
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
  const offers = raw.filter((o) => (o.status || 'pending') === 'pending').map((o) => buildOffer(o, league, byId, enr));
  return annotateTags(offers, token);
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
// A "start a trade here" nudge for the hub: the positions where YOU have surplus and at
// least one rival has a need — i.e. where a deal is most likely to click. Derived from
// the same needs/surplus map the desk uses. Returns null when there's no clear match.
function tradeFitSummary(ns, myFranchiseId) {
  const me = ns && ns[String(myFranchiseId)];
  if (!me || !me.surplus || !me.surplus.length) return null;
  const mySurplus = new Set(me.surplus.map((s) => s.pos));
  const rivalNeed = {}; // pos -> # of rivals who need it
  for (const [fid, v] of Object.entries(ns)) {
    if (fid === String(myFranchiseId)) continue;
    for (const n of v.needs || []) if (mySurplus.has(n.pos)) rivalNeed[n.pos] = (rivalNeed[n.pos] || 0) + 1;
  }
  const positions = Object.keys(rivalNeed).sort((a, b) => rivalNeed[b] - rivalNeed[a]);
  if (!positions.length) return null;
  return { positions, topPos: positions[0], rivals: rivalNeed[positions[0]] };
}

async function getOverview(cookie, token) {
  const leagues = await leaguesService.orderedLeagues(cookie, token);
  const byId = await playersLib.load(cookie);
  const groups = await Promise.all(
    leagues.map(async (league) => {
      try {
        const enr = await enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie);
        const offers = await offersForLeague(cookie, token, league, byId, enr);
        // Read the league's needs/surplus once and use it for BOTH the construction
        // verdict on any offers AND the "start a trade here" fit nudge. Best-effort: a
        // roster-read failure just means value-only offers and no fit hint.
        let fit = null;
        try {
          const d = await tradeData(cookie, token, league.leagueId);
          if (offers.length) annotateConstruction(offers, d.ns, league.franchiseId);
          fit = tradeFitSummary(d.ns, league.franchiseId);
        } catch (e) { /* value-only */ }
        return { offers, fit, leagueId: String(league.leagueId) };
      } catch (e) {
        return { offers: [], fit: null, leagueId: String(league.leagueId) };
      }
    })
  );
  const offers = groups.flatMap((g) => g.offers).filter((o) => o.direction === 'incoming');
  const fitByLeague = new Map(groups.map((g) => [g.leagueId, g.fit]));
  return {
    offers,
    // Every league you're in, so the hub can start a NEW trade in any of them — not just
    // respond to offers sitting in the inbox — each with a fit hint where one exists.
    leagues: leagues.map((l) => ({ leagueId: l.leagueId, name: l.name, fit: fitByLeague.get(String(l.leagueId)) || null })),
    summary: {
      count: offers.length,
      favorable: offers.filter((o) => o.analysis.verdict === 'favorable').length,
    },
  };
}

// Shared load for the trade desk: my roster, the partners' rosters, format-aware values,
// and the league-relative needs/surplus for every franchise (from the starting-lineup
// requirements). Both getLeague and the suggestion endpoint build on this.
async function tradeData(cookie, token, leagueId) {
  const league = await findLeague(cookie, leagueId);
  const byId = await playersLib.load(cookie);
  const fmt = await leagueFormat.format(cookie, league);
  const enr = await enrichmentLib.snapshot(fmt, cookie);

  const [roster, rawPartners, requirements] = await Promise.all([
    rosterService.getRoster(cookie, leagueId),
    config.demoMode ? Promise.resolve(demo.tradePartners(leagueId)) : liveRosters(cookie, league),
    leagueFormat.requirements(cookie, league).catch(() => []),
  ]);

  const myPlayersAll = [...roster.starters, ...roster.bench];
  // Every franchise's players as { id, position, value } for the needs/surplus model.
  const franchises = [
    { franchiseId: String(league.franchiseId), players: myPlayersAll.map((p) => ({ id: p.id, position: p.position, value: enr.value(p.id) })) },
    ...rawPartners.map((pt) => ({
      franchiseId: String(pt.franchiseId),
      players: (pt.roster || []).map((id) => { const b = playersLib.resolve(byId, id); return { id: String(id), position: b.position, value: enr.value(id) }; }),
    })),
  ];
  const ns = tradefit.needsSurplus(franchises, requirements);
  return { league, byId, enr, roster, rawPartners, requirements, ns, fmt };
}

// One league's offers + everything needed to build a proposal, now with each team's
// positional needs & surplus so you can craft a fair, roster-fitting offer.
async function getLeague(cookie, token, leagueId) {
  const data = await tradeData(cookie, token, leagueId);
  const { league, byId, enr, roster, rawPartners, ns, fmt } = data;
  const offers = annotateConstruction(await offersForLeague(cookie, token, league, byId, enr), ns, league.franchiseId);

  const myPlayers = [...roster.starters, ...roster.bench]
    .map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, value: enr.value(p.id), tag: playerTags.get(token, p.id) }))
    .sort((a, b) => (b.value || 0) - (a.value || 0));
  // Picks carry the real MFL trade token as their id, so a proposal can include them.
  const myPicks = (await picksLib.franchisePicks(cookie, league)).map((p) => asset(p.token, byId, enr));

  const partners = rawPartners.map((pt) => ({
    franchiseId: pt.franchiseId,
    name: pt.name,
    needs: (ns[String(pt.franchiseId)] || {}).needs || [],
    surplus: (ns[String(pt.franchiseId)] || {}).surplus || [],
    depth: (ns[String(pt.franchiseId)] || {}).depth || {},
    players: (pt.roster || [])
      .map((id) => { const a = asset(id, byId, enr); if (a.kind !== 'pick') a.tag = playerTags.get(token, a.id) || null; return a; })
      .sort((a, b) => (b.value || 0) - (a.value || 0)),
  }));

  const mine = ns[String(league.franchiseId)] || { needs: [], surplus: [], depth: {} };
  return {
    leagueId: league.leagueId,
    name: league.name,
    offers,
    myPlayers,
    myPicks,
    partners,
    me: { name: roster.franchiseName || 'My Team', needs: mine.needs, surplus: mine.surplus, depth: mine.depth },
    // The scoring/roster format these values reflect (e.g. "Superflex · TE-premium").
    format: leagueFormat.label(fmt),
  };
}

// A suggested give-package to acquire `targetId` from `partnerFranchiseId`: fair by
// league-specific value AND biased to the partner's positional needs (drawn from your
// surplus). Powers the "Suggest" button and the seeded offer when you start from a player.
async function suggestFor(cookie, token, leagueId, targetId, partnerFranchiseId) {
  const data = await tradeData(cookie, token, leagueId);
  const { league, enr, roster, ns } = data;
  const tid = String(targetId);
  const targetValue = enr.value(tid) || 0;
  const partnerNeeds = (ns[String(partnerFranchiseId)] || {}).needs || [];
  const baitMap = await tradeBaitByFranchise(cookie, token, league);
  const myBait = baitMap.get(String(league.franchiseId)) || new Set();
  const mine = [...roster.starters, ...roster.bench]
    .map((p) => ({ id: p.id, name: p.name, position: p.position, value: enr.value(p.id) || 0, tag: playerTags.get(token, p.id) }));
  const give = tradefit.suggestGive(mine, targetValue, partnerNeeds, myBait);
  return {
    leagueId: league.leagueId,
    targetId: tid,
    targetValue,
    give: give.map((g) => ({ id: g.id, name: g.name, position: g.position, value: g.value, bait: myBait.has(String(g.id)), tag: g.tag || null })),
    giveValue: Math.round(give.reduce((s, g) => s + (g.value || 0), 0) * 10) / 10,
    partnerNeeds,
  };
}

// A COUNTER to an incoming offer: keep the offer's construction (same players, same
// shape) but rebalance to fair value. If their offer leaves you light, ask for one more
// of their players — preferring one on THEIR trade bait (they're willing to move him)
// or at YOUR need — else trim your give. You come out at/above fair.
async function counterFor(cookie, token, leagueId, offerId) {
  const data = await tradeData(cookie, token, leagueId);
  const { league, byId, enr, roster, rawPartners, ns } = data;
  const offers = await offersForLeague(cookie, token, league, byId, enr);
  const offer = offers.find((o) => String(o.id) === String(offerId));
  if (!offer) { const e = new Error('That offer is no longer available.'); e.status = 404; throw e; }

  const partnerId = String(offer.withFranchiseId || '');
  const partner = rawPartners.find((p) => String(p.franchiseId) === partnerId);
  const myIds = new Set([...roster.starters, ...roster.bench].map((p) => String(p.id)));
  const baitMap = await tradeBaitByFranchise(cookie, token, league);
  const theirBait = baitMap.get(partnerId) || new Set();
  const myNeeds = new Set(((ns[String(league.franchiseId)] || {}).needs || []).map((n) => n.pos));

  const val = (arr) => Math.round(arr.reduce((s, a) => s + (a.value || 0), 0) * 10) / 10;
  // I receive what they offered; I give what they asked. Rebalance from there.
  const receive = offer.acquire.map((a) => ({ ...a }));
  let give = offer.send.map((a) => ({ ...a }));
  const inRecv = new Set(receive.map((a) => String(a.id)));
  // Their other tradeable players (not already in the deal, and not mine) I could ask for.
  const partnerPool = (partner ? partner.roster : [])
    .map((id) => { const a = asset(id, byId, enr); a.tag = playerTags.get(token, a.id) || null; return a; })
    .filter((a) => (a.value || 0) > 0 && !inRecv.has(String(a.id)) && !myIds.has(String(a.id)));

  const FAIR = 0.06;
  const scale = () => Math.max(val(receive), val(give), 1);
  const added = [];
  let guard = 0;
  while (val(receive) - val(give) < -FAIR * scale() && guard++ < 3) {
    const deficit = val(give) - val(receive);
    const cands = partnerPool.filter((a) => !inRecv.has(String(a.id)));
    if (!cands.length) {
      // Nothing to ask for — trim my least-valuable give instead, if I can.
      if (give.length > 1) { give = give.slice().sort((a, b) => (a.value || 0) - (b.value || 0)).slice(1); continue; }
      break;
    }
    const score = (a) => {
      const v = a.value || 0;
      const near = -Math.abs(v - deficit);
      const overshoot = v > deficit * 1.4 ? -(v - deficit * 1.4) : 0;
      const baitBonus = theirBait.has(String(a.id)) ? 30 : 0;
      const needBonus = myNeeds.has(a.position) ? 15 : 0;
      const targetBonus = a.tag === 'target' ? 25 : a.tag === 'avoid' ? -25 : 0; // ask for your Targets, not your Avoids
      return near * 0.5 + overshoot + baitBonus + needBonus + targetBonus;
    };
    cands.sort((a, b) => score(b) - score(a));
    const pick = cands[0];
    // If the best add would swing it wildly in my favor, prefer trimming my give.
    if (val(receive) + (pick.value || 0) - val(give) > 0.25 * scale() && give.length > 1) {
      give = give.slice().sort((a, b) => (a.value || 0) - (b.value || 0)).slice(1);
      continue;
    }
    receive.push(pick);
    inRecv.add(String(pick.id));
    added.push(pick);
  }

  const net = val(receive) - val(give);
  const short = Math.abs(Math.round(offer.analysis.net));
  let rationale;
  if (added.length) {
    const names = added.map((a) => a.name.split(',')[0]).join(' + ');
    const baited = added.some((a) => theirBait.has(String(a.id)));
    rationale = `Their offer left you about ${short} light. Counter keeps the same shape but also asks for ${names}${baited ? ' (on their block)' : ''}.`;
  } else if (net >= 0) {
    rationale = 'Their offer is already fair to you — sent back as-is to lock it in.';
  } else {
    rationale = 'Kept the same shape; nudge it from here.';
  }

  return {
    leagueId: league.leagueId,
    counterOfferId: String(offer.id),
    toFranchiseId: partnerId,
    partnerName: offer.withName,
    give: give.map((a) => ({ id: a.id, name: a.name, position: a.position, value: a.value })),
    receive: receive.map((a) => ({ id: a.id, name: a.name, position: a.position, value: a.value, bait: theirBait.has(String(a.id)) })),
    giveValue: val(give),
    receiveValue: val(receive),
    rationale,
  };
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
  // Accepting a trade changes my roster on MFL — drop the cached roster so the next
  // read reflects it. (Rejecting changes nothing.)
  if (act === 'accept') rosterService.invalidate(cookie, leagueId);
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
    const willGiveUp = giveIds.join(',');
    const willReceive = recvIds.join(',');
    try {
      await mfl.importRequest('tradeProposal', {
        host: league.host,
        cookie,
        L: league.leagueId,
        FRANCHISE: league.franchiseId,
        OFFEREDTO: toFranchiseId,
        WILL_GIVE_UP: willGiveUp,
        WILL_RECEIVE: willReceive,
        COMMENTS: payload.comments || '',
      });
    } catch (e) {
      // Surface MFL's actual complaint (it's on e.mflError / e.body) instead of a bare
      // status code, and log the exact asset lists so a rejected proposal is diagnosable.
      const detail = e.mflError || (e.body && String(e.body).replace(/<[^>]+>/g, ' ').trim().slice(0, 300)) || e.message;
      // eslint-disable-next-line no-console
      console.warn('[trades] tradeProposal rejected', JSON.stringify({
        L: league.leagueId, FRANCHISE: league.franchiseId, OFFEREDTO: toFranchiseId,
        WILL_GIVE_UP: willGiveUp, WILL_RECEIVE: willReceive, status: e.status, detail,
      }));
      const err = new Error(`MFL rejected the proposal: ${detail}`);
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

// Suggest a fair give-package from `mine` (my players, value-desc) to acquire a
// target worth `targetValue`. Prefers a single close-value player, else a small
// package. Advisory — the user reviews it before sending.
function suggestGive(mine, targetValue) {
  if (!mine.length) return [];
  if (!targetValue) return mine.slice(0, 1);
  // Closest single that isn't a gross overpay (>25% over).
  let best = null;
  let bestDiff = Infinity;
  for (const p of mine) {
    const v = p.value || 0;
    if (v > targetValue * 1.25) continue;
    const d = Math.abs(v - targetValue);
    if (d < bestDiff) { bestDiff = d; best = p; }
  }
  if (best && (best.value || 0) >= targetValue * 0.85) return [best]; // fair 1-for-1
  // Otherwise assemble a package from players at/under ~target until it's fair.
  const pkg = [];
  let sum = 0;
  for (const p of mine) {
    if ((p.value || 0) <= targetValue * 1.1) {
      pkg.push(p);
      sum += p.value || 0;
      if (pkg.length >= 3 || sum >= targetValue * 0.9) break;
    }
  }
  if (pkg.length) return pkg;
  // Everyone's well above target (a stacked roster) — offer the smallest single.
  return best ? [best] : [mine[mine.length - 1]];
}

// Cross-league trade targeting: for ONE target player, find every league where
// he's on another team's roster, and for each surface the owner + a suggested
// fair give-package from your roster there. The trade equivalent of "add across
// leagues" — you shop the same player across your portfolio in one flow.
async function crossLeaguePreview(cookie, token, targetId) {
  const tid = String(targetId);
  const leagues = await leaguesService.listLeagues(cookie);
  const byId = await playersLib.load(cookie);
  const target = playersLib.resolve(byId, tid);
  // Probe every league in parallel — sequential awaits here meant N round-trips
  // back-to-back, the slow part of this endpoint. Leagues where he's not a trade
  // target (already yours, or a free agent) resolve to null and drop out.
  const probed = await Promise.all(
    leagues.map(async (league) => {
      try {
        const enr = await enrichmentLib.snapshot(await leagueFormat.format(cookie, league), cookie);
        const [roster, rawPartners] = await Promise.all([
          rosterService.getRoster(cookie, league.leagueId),
          config.demoMode ? Promise.resolve(demo.tradePartners(league.leagueId)) : liveRosters(cookie, league),
        ]);
        const myIds = new Set([...roster.starters, ...roster.bench, ...roster.ir, ...roster.taxi].map((p) => p.id));
        if (myIds.has(tid)) return null; // already yours
        const owner = rawPartners.find((pt) => (pt.roster || []).map(String).includes(tid));
        if (!owner) return null; // free agent / not on a partner roster -> not a trade target
        const targetValue = enr.value(tid) || 0;
        const mine = [...roster.starters, ...roster.bench]
          .map((p) => ({ id: p.id, name: p.name, position: p.position, value: enr.value(p.id) || 0 }))
          .sort((a, b) => b.value - a.value);
        const give = suggestGive(mine, targetValue);
        return {
          leagueId: league.leagueId,
          name: league.name,
          partnerFranchiseId: owner.franchiseId,
          partnerName: owner.name,
          targetValue,
          suggestedGive: give.map((g) => ({ id: g.id, name: g.name, position: g.position, value: g.value })),
          giveValue: Math.round(give.reduce((s, g) => s + (g.value || 0), 0) * 10) / 10,
        };
      } catch (e) {
        return null; // skip a league we couldn't read
      }
    })
  );
  const out = probed.filter(Boolean);
  return { player: { id: target.id, name: target.name, position: target.position, team: target.team }, leagues: out };
}

// Send the target-player trade offer in each selected league. Each selection
// carries { leagueId, partnerFranchiseId, giveIds }.
async function crossLeaguePropose(cookie, token, targetId, selections) {
  const tid = String(targetId);
  const results = await Promise.all(
    (selections || []).map(async (s) => {
      try {
        if (!s.giveIds || !s.giveIds.length) throwBad('Nothing to offer in this league.');
        const res = await propose(cookie, token, s.leagueId, { toFranchiseId: s.partnerFranchiseId, give: s.giveIds, receive: [tid] });
        return { leagueId: s.leagueId, ok: true, offer: res.offer };
      } catch (e) {
        return { leagueId: s.leagueId, ok: false, error: e.message };
      }
    })
  );
  return { results, summary: { requested: results.length, submitted: results.filter((r) => r.ok).length } };
}

function throwBad(msg) {
  const err = new Error(msg);
  err.status = 400;
  throw err;
}

module.exports = { getOverview, getLeague, respond, propose, analyze, crossLeaguePreview, crossLeaguePropose, suggestFor, counterFor, tradeFitSummary, tradeBaitByFranchise, personalAnalyze, tagNotes };
