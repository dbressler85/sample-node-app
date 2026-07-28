'use strict';

// Trades (M5). View incoming offers across leagues with dynasty-value analysis,
// accept/reject them, and propose new trades to other franchises. Values come
// from the format-aware enrichment layer, so "who wins" respects each league's
// superflex/PPR settings. MFL is the system of record in live (pendingTrades +
// import tradeResponse/tradeProposal); demo uses a seeded in-memory store.

const config = require('../config');
const demo = require('../demo/fixtures');
const mfl = require('../lib/mfl');
const mflRepo = require('../lib/mflRepo');
const { logDegrade } = require('../lib/safe');
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');
const playersLib = require('../lib/players');
const picksLib = require('../lib/picks');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const draftService = require('./draft');
const { createMemo } = require('../lib/memo');
const tradeStore = require('../store/trades');
const playerTags = require('../store/playerTags');
const baitStore = require('../store/tradebait');
const tradeDeadlines = require('../store/tradeDeadlines');
const tradefit = require('../lib/tradefit');
const tradeMath = require('../lib/tradeMath');
const season = require('../lib/season');
const rosterStatus = require('../lib/rosterStatus');

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
      for (const b of await mflRepo.tradeBaits(league, cookie)) {
        const fid = mfl.text(mfl.attr(b, 'franchise_id')) || '';
        if (!fid) continue;
        const ids = mfl.text(mfl.attr(b, 'willGiveUp')).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
        map.set(fid, new Set(ids));
      }
      // Union any local optimistic adds (just shopped in-app, MFL write may lag a beat) into MY set,
      // so a just-blocked player is flagged on the desk immediately even before MFL reflects it.
      if (mineIds.length) {
        const cur = map.get(String(league.franchiseId)) || new Set();
        for (const id of mineIds) cur.add(String(id));
        map.set(String(league.franchiseId), cur);
      }
    } catch (e) {
      /* no board -> no bait signal */
    }
  }
  return map;
}

// Pick value comes from the shared model in lib/picks (picksLib.value) so the roster's pick chips and
// the trade desk always agree. Passing the token + enrichment snapshot makes it FORMAT-AWARE: it uses
// FantasyCalc's per-slot pick value for the league's format when available, else the local curve.
function pickValue(label, token, enr) {
  return picksLib.value(label, token, enr);
}

// Blind-bidding budget (FAAB) is tradeable in most leagues; MFL represents an amount of it
// as a `BB_<dollars>` token in a trade's give/receive lists (e.g. `BB_20` = $20, decimals
// possible). Parse the amount, or null if the token isn't FAAB.
function faabAmount(tok) {
  const m = /^BB_(\d+(?:\.\d+)?)$/.exec(String(tok));
  return m ? Number(m[1]) : null;
}
// The FAAB token to put in a proposal for `$amount`. MFL wants no trailing zeros ("BB_20").
function faabToken(amount) {
  return `BB_${Number(amount)}`;
}
// A rough dynasty value for $X of FAAB so the deal's value read isn't blind to it. FAAB is
// worth far less than its face in dynasty terms (and varies by league budget), so weight it
// lightly and mark the whole analysis "estimated" as we already do. Tunable in one place.
const FAAB_VALUE_PER_DOLLAR = 0.2;
function faabValue(amount) {
  return Math.round((amount || 0) * FAAB_VALUE_PER_DOLLAR);
}
function faabLabel(amount) {
  const n = Number(amount);
  return `$${Number.isInteger(n) ? n : n.toFixed(2)} FAAB`;
}

// Resolve an asset token to a display object + value. A token is a player id, a
// demo 'pick:LABEL', a live MFL future-pick token 'FP_<orig>_<year>_<round>', an
// upcoming-draft pick token 'DP_<round>_<pick>' (both zero-based), or FAAB 'BB_<dollars>'.
function asset(tok, byId, enr) {
  const t = String(tok);
  const bb = faabAmount(t);
  if (bb != null) {
    // FAAB buys players NOW, so it counts the same toward win-now as toward dynasty.
    return { kind: 'faab', id: t, name: faabLabel(bb), position: 'FAAB', team: null, amount: bb, value: faabValue(bb), winNow: faabValue(bb) };
  }
  if (t.startsWith('pick:') || t.startsWith('FP_') || t.startsWith('DP_')) {
    const label = t.startsWith('pick:') ? t.slice(5) : picksLib.labelForToken(t);
    // Draft picks are future assets — they don't help you win THIS season, so their win-now value
    // is ~0. That's what makes "give picks, get a proven vet" read as a WIN for a contender.
    return { kind: 'pick', id: t, name: label, position: 'PICK', team: null, value: pickValue(label, t, enr), winNow: 0 };
  }
  const p = playersLib.resolve(byId, t);
  return { kind: 'player', id: p.id, name: p.name, position: p.position, team: p.team, value: enr.value(p.id), winNow: enr.winNow ? enr.winNow(p.id) : null };
}

// Value analysis for one side vs the other (from my perspective). The math is the shared
// tradeMath.analyze (single source with the mobile preview); `estimated: true` is added here —
// the values are model estimates (enrichment dynasty values + a pick model) and the thresholds
// are heuristic, so the UI marks it.
function analyze(acquire, send) {
  return { ...tradeMath.analyze(acquire, send), estimated: true };
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
    expires: raw.expires || null,
    comments: raw.comments || null,
    // Accept/reject only make sense on an incoming offer we can actually target on MFL (has a
    // trade id). The UI hides the buttons when this is false rather than firing a doomed call.
    canRespond: (raw.direction || 'incoming') === 'incoming' && raw.id != null,
    // Revoke (withdraw) is the mirror — only the originator of an OUTGOING offer can do it, and
    // only when we have the MFL trade id to target.
    canRevoke: (raw.direction || 'incoming') === 'outgoing' && raw.id != null,
    acquire,
    send,
    analysis: analyze(acquire, send),
  };
}

// Reconcile the two verdicts into one bottom line, so a deal that's good on VALUE but bad for
// ROSTER (or vice-versa) doesn't just show two contradicting badges. Deterministic over the
// value verdict (favorable/fair/unfavorable) × construction rating (good/caution/neutral).
// `tone` drives the color: good / warn / bad / neutral.
const BOTTOM_LINE = {
  favorable: {
    good: { tone: 'good', text: 'Green light — you gain value and it fits your roster.' },
    caution: { tone: 'warn', text: 'Value’s in your favor, but it dents your roster — weigh the need first.' },
    neutral: { tone: 'good', text: 'A clean value gain with no roster downside.' },
  },
  fair: {
    good: { tone: 'good', text: 'Even on value and it fills a need — a fair deal worth doing.' },
    caution: { tone: 'warn', text: 'Even on value but it opens a hole — lean pass unless you can backfill.' },
    neutral: { tone: 'neutral', text: 'A fair, roster-neutral swap.' },
  },
  unfavorable: {
    good: { tone: 'warn', text: 'You’d pay a value premium, but it fills a real need — OK if you’re contending.' },
    caution: { tone: 'bad', text: 'Loses value and weakens your roster — pass.' },
    neutral: { tone: 'bad', text: 'You come out light on value with no roster gain — pass.' },
  },
};
function bottomLine(verdict, rating) {
  const byV = BOTTOM_LINE[verdict] || BOTTOM_LINE.fair;
  return byV[rating] || byV.neutral;
}

// Attach a roster-construction read (does this deal fix a hole or open one?) to each
// offer. `construction` is from MY side — I give `send`, I get `acquire`. For offers where
// the other team is known, `partnerConstruction` is the mirror from THEIR side — they give
// `acquire`, they get `send` — so an outgoing offer shows whether it also helps them (i.e.
// whether they're likely to bite). `bottomLine` reconciles value + construction into one take.
function annotateConstruction(offers, ns, franchiseId, myOutlook) {
  const mine = ns[String(franchiseId)] || { needs: [], surplus: [], depth: {} };
  for (const o of offers) {
    o.construction = tradefit.constructionVerdict(o.send, o.acquire, mine.needs, mine.surplus, 'you', mine.depth);
    const theirs = o.withFranchiseId ? ns[String(o.withFranchiseId)] : null;
    if (theirs) o.partnerConstruction = tradefit.constructionVerdict(o.acquire, o.send, theirs.needs, theirs.surplus, 'they', theirs.depth);
    // Reconcile using the verdict of the lens your WINDOW cares about: a contender is judged on
    // win-now value (so a dynasty-favorable "sell the vet" deal reads as a warning), everyone else
    // on dynasty value. The lead lens is stamped on the analysis so the client can label it.
    const lead = tradeMath.leadingLens(o.analysis, myOutlook);
    if (o.analysis) { o.analysis.lens = lead.lens; o.analysis.leadVerdict = lead.verdict; }
    o.bottomLine = bottomLine(lead.verdict, o.construction && o.construction.rating);
  }
  return offers;
}

// Personal-value overlay from Target/Avoid tags. Market `analysis` stays untouched (it's
// the honest, partner-visible read); this is "for YOU" — the same math over tag-adjusted
// values (Target ×1.10, Avoid ×0.90). Only computed when a tagged player is involved.
function personalAnalyze(acquire, send) {
  // Shared tag-adjusted analysis (TAG_MOD matches playerTags.modifier); keep the `estimated` mark.
  const pa = tradeMath.personalAnalyze(acquire, send);
  return pa ? { ...pa, estimated: true } : null;
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
    for (const a of [...o.acquire, ...o.send]) if (a.kind === 'player') a.tag = playerTags.get(token, a.id) || null;
    o.personal = personalAnalyze(o.acquire, o.send); // null when nothing's tagged
    o.tagNotes = tagNotes(o.acquire, o.send);
  }
  return offers;
}

// --- live helpers -----------------------------------------------------------

async function livePendingOffers(cookie, league) {
  try {
    // MFL documents this param as FRANCHISE_ID (only honored for a commissioner request;
    // an owner's cookie already scopes the response to their own franchise). The transient-throttle
    // retry lives at the source now (mflRepo.pendingTrades), so a rate-limited read in the cross-league
    // inbox fan-out recovers instead of vanishing the offer from the inbox, On Deck, and the push.
    const list = await mflRepo.pendingTrades(league, cookie, { FRANCHISE_ID: league.franchiseId });
    if (!list.length) return [];
    const names = await leaguesService.franchiseNames(cookie, league);
    const toks = (v) => mfl.text(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    const me = league.franchiseId;
    // MFL's pendingTrades returns EVERY pending trade involving my franchise — both offers made TO me
    // (I'm `offeredto`) AND offers I SENT (I'm `offeringteam`). Emit both so my sent offers are
    // visible (and withdrawable), not just my inbox. Perspective is always MINE.
    return list
      .map((tr) => {
        const offeredTo = mfl.text(mfl.attr(tr, 'offeredto'));
        const offeringTeam = mfl.text(mfl.attr(tr, 'offeringteam'));
        const incoming = offeredTo === me; // they offered to me
        const outgoing = offeringTeam === me; // I offered to them
        if (!incoming && !outgoing) return null; // not mine (shouldn't happen under the cookie scope)
        const withId = incoming ? offeringTeam : offeredTo;
        // The trade id is what tradeResponse (accept/reject/revoke) targets — hitting the WRONG id (or
        // a made-up one) is the worst failure here, so extract it explicitly and never fall back to an
        // array index. If MFL doesn't give one, log the raw keys and leave id null (the UI keeps the
        // offer visible but read-only).
        const tradeIdRaw = mfl.attr(tr, 'trade_id', 'id', 'tradeid');
        if (tradeIdRaw == null) console.warn(`[trades] pendingTrade with no trade_id (L=${league.leagueId}); attrs: ${Object.keys(tr || {}).join(',')}`);
        // MFL names the sides `will_give_up` / `will_receive` from the OFFERER's point of view.
        // attr() matches any casing (the receive side previously only checked camelCase → "give · 0").
        const willGiveUp = toks(mfl.attr(tr, 'willgiveup'));
        const willReceive = toks(mfl.attr(tr, 'willreceive', 'willreceiveinreturn'));
        // Re-cast to MY perspective (acquire = what I'd get, send = what I'd give):
        //   incoming — the OFFERER gives up willGiveUp (I acquire it) and receives willReceive (I send it).
        //   outgoing — I am the offerer, so I give up willGiveUp (I send it) and receive willReceive (I acquire it).
        return {
          id: mfl.text(tradeIdRaw) || null,
          direction: incoming ? 'incoming' : 'outgoing',
          status: 'pending',
          withFranchiseId: withId,
          withName: names.get(withId) || 'Another team',
          expires: mfl.text(mfl.attr(tr, 'expires')) || null,
          comments: mfl.text(mfl.attr(tr, 'comments', 'message')) || null,
          acquire: incoming ? willGiveUp : willReceive,
          send: incoming ? willReceive : willGiveUp,
        };
      })
      .filter(Boolean);
  } catch (e) {
    logDegrade(`trades.livePendingOffers league=${league.leagueId}`, e);
    return [];
  }
}

// My ACCEPTED (completed) trades from the transactions log — the history behind the Sent tab's
// toggle. MFL logs a TRADE as `<side0>|<side1>|<otherFranchise>` from the ROW franchise's give/
// receive perspective; re-cast to MINE (acquire = what I got, send = what I gave) whether I'm the row
// franchise or the counterparty. Read-only history; no distinction of who initiated (MFL doesn't
// record it) — these are simply my completed deals. Fail-soft. Returns raw token lists; the caller
// resolves them to assets with the same `asset()` used for offers.
async function myCompletedTrades(cookie, league) {
  const me = String(league.franchiseId);
  const csv = (s) => mfl.text(s).split(',').map((x) => x.trim()).filter(Boolean);
  if (config.demoMode) {
    return (demo.transactions(league.leagueId) || [])
      .filter((t) => String(t.type).toUpperCase() === 'TRADE')
      .map((t) => {
        const f = String(t.franchiseId);
        const w = String(t.withFranchiseId || '');
        if (f === me) return { withFranchiseId: w, withName: t.withFranchiseName || null, sendToks: t.droppedIds || [], acquireToks: t.addedIds || [], at: t.at || null };
        if (w === me) return { withFranchiseId: f, withName: t.franchiseName || null, sendToks: t.addedIds || [], acquireToks: t.droppedIds || [], at: t.at || null };
        return null;
      })
      .filter(Boolean);
  }
  try {
    const [txns, names] = await Promise.all([
      mflRepo.transactions(league, cookie, { TRANS_TYPE: 'TRADE', COUNT: 25 }),
      leaguesService.franchiseNames(cookie, league).catch(() => new Map()),
    ]);
    const out = [];
    for (const t of txns) {
      if (mfl.text(t.type).toUpperCase() !== 'TRADE') continue;
      const p = mfl.text(t.transaction).split('|');
      const rowFr = mfl.text(t.franchise);
      const other = p[2] ? mfl.fid(p[2]) : null;
      const side0 = csv(p[0]); // what the row franchise GAVE
      const side1 = csv(p[1]); // what the row franchise RECEIVED
      let withId; let sendToks; let acquireToks;
      if (rowFr === me) { withId = other; sendToks = side0; acquireToks = side1; }
      else if (other === me) { withId = rowFr; sendToks = side1; acquireToks = side0; }
      else continue; // not my trade
      out.push({ withFranchiseId: withId, withName: names.get(String(withId)) || 'Another team', sendToks, acquireToks, at: mfl.num(t.timestamp) });
    }
    out.sort((a, b) => (b.at || 0) - (a.at || 0));
    return out;
  } catch (e) {
    logDegrade(`trades.myCompletedTrades league=${league.leagueId}`, e);
    return [];
  }
}

async function liveRosters(cookie, league) {
  try {
    const franchises = await mflRepo.rosters(league, cookie);
    const names = await leaguesService.franchiseNames(cookie, league);
    return franchises
      .filter((f) => String(f.id) !== league.franchiseId)
      .map((f) => ({
        franchiseId: String(f.id),
        name: names.get(String(f.id)) || `Team ${f.id}`,
        roster: mfl.toArray(f.player)
          .filter((p) => !rosterStatus.isReserve(p)) // exclude IR/taxi from tradeable candidates
          .map((p) => String(p.id)),
      }));
  } catch (e) {
    logDegrade(`trades.liveRosters league=${league.leagueId}`, e);
    return [];
  }
}

// Raw pending offers for a league (token lists, no value enrichment). Cheap enough
// to run for every league on the inbox — just the pendingTrades read in live — so
// the expensive format-aware values + roster reads are paid only where an offer
// actually exists.
async function rawOffers(cookie, token, league) {
  const raw = config.demoMode
    ? tradeStore.list(token, league.leagueId, demo.tradeOffers(league.leagueId))
    : await livePendingOffers(cookie, league);
  return raw.filter((o) => (o.status || 'pending') === 'pending');
}

// Pending offers for one league, value-analyzed (seeded store in demo; MFL in live).
async function offersForLeague(cookie, token, league, byId, enr) {
  const offers = (await rawOffers(cookie, token, league)).map((o) => buildOffer(o, league, byId, enr));
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
        // Read the pending offers first — cheap — and bail before the expensive work
        // on the many leagues with an empty inbox. Format-aware values and the
        // needs/surplus roster reads (~a dozen roster reads per league) are the
        // dominant cost of this screen, so only leagues with a real offer pay them.
        const raw = await rawOffers(cookie, token, league);
        if (!raw.length) return { offers: [], fit: null, leagueId: String(league.leagueId) };

        const fmt = await leagueFormat.format(cookie, league);
        const enr = await enrichmentLib.snapshot(fmt, cookie);
        const offers = annotateTags(raw.map((o) => buildOffer(o, league, byId, enr)), token);
        // League format (SF/1QB · PPR) is cheap and always useful on the card.
        const fmtLabel = leagueFormat.label(fmt);
        offers.forEach((o) => { o.format = fmtLabel; });
        // The "start a trade here" fit hint is computed on demand when you open the
        // league (getLeague). Best-effort: a roster-read failure just means value-only.
        let fit = null;
        try {
          const d = await tradeData(cookie, token, league.leagueId);
          const meCtx = d.teamOutlook[String(league.franchiseId)] || null;
          annotateConstruction(offers, d.ns, league.franchiseId, meCtx && meCtx.outlook);
          fit = tradeFitSummary(d.ns, league.franchiseId);
          // Both sides' dynasty context so the inbox shows each team's outlook + age.
          offers.forEach((o) => { o.me = meCtx; o.partner = d.teamOutlook[String(o.withFranchiseId)] || null; });
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
    // Advisory-only timing nudge (draft season vs in-season) — doesn't touch any value.
    seasonal: season.advisory(),
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
  // The global player universe is independent of this league's format — load it alongside
  // the format read rather than after it. (enr depends on fmt, so it stays sequential.)
  const [byId, fmt] = await Promise.all([playersLib.load(cookie), leagueFormat.format(cookie, league)]);
  const enr = await enrichmentLib.snapshot(fmt, cookie);

  // Each read is independently caught: a single flaky MFL response (a malformed roster, an
  // unreadable partner list) must degrade the desk — fewer selectable assets — not 500 the
  // whole screen. A failed roster falls back to an empty one so incoming offers still load.
  const EMPTY_ROSTER = { starters: [], bench: [], ir: [], taxi: [], franchiseName: null };
  const [roster, rawPartners, requirements, standingsRows] = await Promise.all([
    rosterService.getRoster(cookie, leagueId).catch((e) => { console.warn(`[trades] getRoster failed for L=${leagueId}: ${e.message}`); return EMPTY_ROSTER; }),
    (config.demoMode ? Promise.resolve(demo.tradePartners(leagueId)) : liveRosters(cookie, league)).catch(() => []),
    leagueFormat.requirements(cookie, league).catch(() => []),
    // Season record → the "is this window live?" axis of each team's outlook. Best-effort.
    (config.demoMode ? Promise.resolve(demo.standings(leagueId)) : mflRepo.standings(league, cookie)).catch(() => null),
  ]);

  const myPlayersAll = [...(roster.starters || []), ...(roster.bench || [])];
  // Every franchise's players as { id, position, value, age } — value+age drive the
  // needs/surplus model AND the per-team dynasty outlook / average age below.
  const franchises = [
    { franchiseId: String(league.franchiseId), players: myPlayersAll.map((p) => ({ id: p.id, position: p.position, value: enr.value(p.id), age: enr.age(p.id), winNow: enr.winNow ? enr.winNow(p.id) : null })) },
    ...rawPartners.map((pt) => ({
      franchiseId: String(pt.franchiseId),
      players: (pt.roster || []).map((id) => { const b = playersLib.resolve(byId, id); return { id: String(id), position: b.position, value: enr.value(id), age: enr.age(id), winNow: enr.winNow ? enr.winNow(id) : null }; }),
    })),
  ];
  const ns = tradefit.needsSurplus(franchises, requirements);
  const recordPctMap = rosterService.recordPctByFranchise(standingsRows);
  const teamOutlook = summarizeFranchises(franchises, recordPctMap);
  return { league, byId, enr, roster, rawPartners, requirements, ns, teamOutlook, fmt };
}

// Dynasty outlook (win-now / ascending / rebuilding / balanced) + average roster age for
// every franchise, so the trade desk can show BOTH teams' status and reveal an owner who
// skews young or old. Reuses the roster summary's coreAge/strength/record → outlook rule, so a
// stacked-but-losing partner reads Balanced (not a false Win-now) here just like on my own roster.
function summarizeFranchises(franchises, recordPctMap) {
  const record = recordPctMap instanceof Map ? recordPctMap : new Map();
  const totals = franchises.map((f) => ({ id: String(f.franchiseId), total: (f.players || []).reduce((s, p) => s + (p.value || 0), 0) }));
  const out = {};
  for (const f of franchises) {
    const valued = (f.players || []).filter((p) => p.value != null);
    const avgAge = valued.length ? Math.round((valued.reduce((s, p) => s + (p.age || 0), 0) / valued.length) * 10) / 10 : null;
    // Production-weighted core age (shared with roster.js) so a partner fielding aging studs reads
    // the age they actually play, matching my own outlook read.
    const coreAge = rosterService.coreAgeOf(f.players);
    const myTotal = (totals.find((t) => t.id === String(f.franchiseId)) || {}).total || 0;
    const strengthPct = totals.length > 1 && myTotal ? totals.filter((t) => t.total <= myTotal).length / totals.length : null;
    const recordPct = record.has(String(f.franchiseId)) ? record.get(String(f.franchiseId)) : null;
    out[String(f.franchiseId)] = { outlook: rosterService.computeOutlook(coreAge, strengthPct, recordPct), avgAge };
  }
  return out;
}

// One league's offers + everything needed to build a proposal, now with each team's
// positional needs & surplus so you can craft a fair, roster-fitting offer.
async function getLeague(cookie, token, leagueId) {
  const data = await tradeData(cookie, token, leagueId);
  const { league, byId, enr, roster, rawPartners, ns, teamOutlook, fmt } = data;

  // These four reads depend only on tradeData's output, not on one another: the pending
  // offers, every franchise's trade-bait board, every franchise's future picks, and the
  // current-year (upcoming-draft) picks. Running them sequentially meant four back-to-back
  // round-trip waves — the dominant cost of opening the desk. Fan them out together.
  //   • trade-bait: mine from our store, everyone else's from MFL's native board — a player
  //     flagged `bait` gets badged as openly on the block (the fastest read on what's available).
  //   • futureDraftPicks covers only FUTURE seasons; current-year picks live in the draft
  //     order, so pull those too or they'd be un-tradeable in the builder/counter.
  //   • in demo the live picks map is empty, so my own picks come from the demo fixture.
  // Every read is caught to a safe default: the offers you came to review must render even if
  // the bait board or a picks read is momentarily flaky — a partial desk beats a 500.
  const [rawLeagueOffers, baitMap, assetsMap, picksMap, upcoming, demoMyPicks, autoDeadlineMs, rawCompleted] = await Promise.all([
    offersForLeague(cookie, token, league, byId, enr).catch((e) => { console.warn(`[trades] offersForLeague failed for L=${leagueId}: ${e.message}`); return []; }),
    tradeBaitByFranchise(cookie, token, league).catch(() => new Map()),
    // Authoritative tradable picks per franchise (post-trade ownership, one read). Null → fall back
    // to composing futureDraftPicks + the draft grid below.
    picksLib.assetsByFranchise(cookie, league).catch(() => null),
    picksLib.franchisePicksMap(cookie, league).catch(() => ({})),
    draftService.upcomingPicksByFranchise(cookie, token, league).catch(() => ({})),
    (config.demoMode ? picksLib.franchisePicks(cookie, league) : Promise.resolve(null)).catch(() => null),
    // MFL's own trade deadline from the league calendar (live only). Manual entry overrides it.
    config.demoMode ? Promise.resolve(null) : nextTradeDeadline(cookie, league).catch(() => null),
    // My accepted (completed) trades — the Sent tab's "show completed" history.
    myCompletedTrades(cookie, league).catch(() => []),
  ]);
  const tradeDeadlineAuto = autoDeadlineMs ? new Date(autoDeadlineMs).toISOString().slice(0, 10) : null;

  const myLeagueOutlook = (teamOutlook[String(league.franchiseId)] || {}).outlook || null;
  const offers = annotateConstruction(rawLeagueOffers, ns, league.franchiseId, myLeagueOutlook);
  // My completed-trade history (read-only), sides resolved to assets from MY perspective + analyzed.
  const completedTrades = (rawCompleted || []).map((t, i) => {
    const acquire = (t.acquireToks || []).map((tk) => asset(tk, byId, enr));
    const send = (t.sendToks || []).map((tk) => asset(tk, byId, enr));
    return {
      id: `ct-${t.at || 'x'}-${i}`,
      withFranchiseId: t.withFranchiseId || null,
      withName: t.withName || (t.withFranchiseId ? `Team ${t.withFranchiseId}` : 'Another team'),
      acquire,
      send,
      analysis: analyze(acquire, send),
      at: t.at || null,
    };
  });
  const myBait = baitMap.get(String(league.franchiseId)) || new Set();
  const picksFor = (fid) => (picksMap[String(fid)] || []).map((p) => asset(p.token, byId, enr));
  const upcomingFor = (fid) => (upcoming[String(fid)] || []).map((p) => asset(p.token, byId, enr));
  // All of a franchise's tradable picks (current-year first, then future). Prefer the authoritative
  // `assets` read; else compose the draft grid (current) + futureDraftPicks (future) as before.
  // Demo has no assets → my picks come from the demo fixture, partners' from the (empty) composition.
  const picksAssetsFor = (fid) => {
    const fromAssets = assetsMap && (assetsMap[String(fid)] || assetsMap[mfl.fid(fid)]);
    if (fromAssets) return fromAssets.map((p) => asset(p.token, byId, enr));
    const future = config.demoMode && String(fid) === String(league.franchiseId)
      ? (demoMyPicks || []).map((p) => asset(p.token, byId, enr))
      : picksFor(fid);
    return [...upcomingFor(fid), ...future];
  };

  const myPlayers = [...(roster.starters || []), ...(roster.bench || [])]
    .map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, value: enr.value(p.id), winNow: enr.winNow ? enr.winNow(p.id) : null, tag: playerTags.get(token, p.id), bait: myBait.has(String(p.id)) }))
    .sort((a, b) => (b.value || 0) - (a.value || 0));
  // Picks carry the real MFL trade token as their id, so a proposal can include them.
  const myPicks = picksAssetsFor(league.franchiseId);

  const partners = rawPartners.map((pt) => {
    const bait = baitMap.get(String(pt.franchiseId)) || new Set();
    const rosterPlayers = (pt.roster || [])
      .map((id) => { const a = asset(id, byId, enr); if (a.kind !== 'pick') a.tag = playerTags.get(token, a.id) || null; a.bait = bait.has(String(a.id)); return a; })
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    return {
      franchiseId: pt.franchiseId,
      name: pt.name,
      outlook: (teamOutlook[String(pt.franchiseId)] || {}).outlook || null,
      avgAge: (teamOutlook[String(pt.franchiseId)] || {}).avgAge || null,
      baitCount: rosterPlayers.filter((a) => a.bait).length,
      needs: (ns[String(pt.franchiseId)] || {}).needs || [],
      surplus: (ns[String(pt.franchiseId)] || {}).surplus || [],
      depth: (ns[String(pt.franchiseId)] || {}).depth || {},
      // Roster players then their draft picks (current-year + future) — the builder sorts picks last.
      players: [...rosterPlayers, ...picksAssetsFor(pt.franchiseId)],
    };
  });

  const mine = ns[String(league.franchiseId)] || { needs: [], surplus: [], depth: {} };
  const myOutlook = teamOutlook[String(league.franchiseId)] || {};
  return {
    leagueId: league.leagueId,
    name: league.name,
    offers,
    completedTrades,
    myPlayers,
    myPicks,
    partners,
    me: { name: roster.franchiseName || 'My Team', outlook: myOutlook.outlook || null, avgAge: myOutlook.avgAge || null, needs: mine.needs, surplus: mine.surplus, depth: mine.depth },
    // Trade deadline. `tradeDeadlineAuto` is MFL's own (from the league calendar); `tradeDeadline`
    // is the owner's manual override (used when set, e.g. a league without one on the calendar).
    tradeDeadline: tradeDeadlines.get(token, leagueId),
    tradeDeadlineAuto,
    // The scoring/roster format these values reflect (e.g. "Superflex · TE-premium").
    format: leagueFormat.label(fmt),
  };
}

// A suggested give-package to acquire `targetId` from `partnerFranchiseId`: fair by
// league-specific value AND biased to the partner's positional needs (drawn from your
// surplus). Powers the "Suggest" button and the seeded offer when you start from a player.
async function suggestFor(cookie, token, leagueId, targetId, partnerFranchiseId) {
  const data = await tradeData(cookie, token, leagueId);
  const { league, byId, enr, roster, ns } = data;
  const tid = String(targetId);
  // Value the target via asset() so it works for a PICK token too (trade FOR a pick you don't own),
  // not just a player id — a player resolves to its dynasty value, a pick to its pick-curve value.
  const targetValue = asset(tid, byId, enr).value || 0;
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

// The counter-ASK: you pick what you'd SEND (players and/or picks from your side), and this
// proposes a fair return to ASK FOR from `partnerFranchiseId` — a package worth ~your send value,
// biased to (a) YOUR positional needs, (b) players the partner is already shopping (their trade
// bait — the ones they'll actually part with), and (c) your tagged Targets (never your Avoids).
// The mirror image of suggestFor. Returns the ask package + a fairness read.
async function askFor(cookie, token, leagueId, sendIds, partnerFranchiseId) {
  const data = await tradeData(cookie, token, leagueId);
  const { league, byId, enr, roster, rawPartners, ns } = data;
  const ids = (Array.isArray(sendIds) ? sendIds : String(sendIds || '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!ids.length) { const e = new Error('Pick at least one player or pick to send.'); e.status = 400; throw e; }

  const partnerId = String(partnerFranchiseId || '');
  const partner = rawPartners.find((p) => String(p.franchiseId) === partnerId);
  if (!partner) { const e = new Error('That team is not in this league.'); e.status = 404; throw e; }

  const myIds = new Set([...roster.starters, ...roster.bench].map((p) => String(p.id)));
  const send = ids.map((id) => asset(id, byId, enr));
  const sendSet = new Set(send.map((a) => String(a.id)));
  const val = (arr) => Math.round(arr.reduce((s, a) => s + (a.value || 0), 0) * 10) / 10;
  const sendValue = val(send);

  const baitMap = await tradeBaitByFranchise(cookie, token, league);
  const theirBait = baitMap.get(partnerId) || new Set();
  const myNeeds = new Set(((ns[String(league.franchiseId)] || {}).needs || []).map((n) => n.pos));

  // Their tradeable players I could ask for (value>0, not already in the deal, not mine).
  const pool = (partner.roster || [])
    .map((id) => { const a = asset(id, byId, enr); a.tag = playerTags.get(token, a.id) || null; a.bait = theirBait.has(String(a.id)); return a; })
    .filter((a) => (a.value || 0) > 0 && !sendSet.has(String(a.id)) && !myIds.has(String(a.id)));

  // Score a candidate for the ask: close to the remaining deficit, prefer their bait, my needs,
  // and my Targets; steer off my Avoids. (Same weights as the counter-offer rebalancer.)
  const score = (a, deficit) => {
    const v = a.value || 0;
    const near = -Math.abs(v - deficit);
    const baitBonus = a.bait ? 30 : 0;
    const needBonus = myNeeds.has(a.position) ? 15 : 0;
    const tagBonus = a.tag === 'target' ? 25 : a.tag === 'avoid' ? -25 : 0;
    return near * 0.5 + baitBonus + needBonus + tagBonus;
  };

  const ask = [];
  const chosen = new Set();
  let guard = 0;
  while (val(ask) < sendValue * 0.9 && guard++ < 3) {
    const deficit = sendValue - val(ask);
    const cands = pool.filter((a) => !chosen.has(String(a.id)) && val(ask) + (a.value || 0) <= sendValue * 1.25);
    if (!cands.length) break;
    cands.sort((a, b) => score(b, deficit) - score(a, deficit));
    ask.push(cands[0]);
    chosen.add(String(cands[0].id));
  }
  // Everyone left is above the 125% cap (a top-heavy roster) — ask for their single closest.
  if (!ask.length && pool.length) {
    ask.push(pool.slice().sort((a, b) => Math.abs((a.value || 0) - sendValue) - Math.abs((b.value || 0) - sendValue))[0]);
  }

  const askValue = val(ask);
  const scaleV = Math.max(sendValue, askValue, 1);
  const diff = askValue - sendValue;
  const verdict = diff > 0.08 * scaleV ? 'favorable' : diff < -0.08 * scaleV ? 'light' : 'fair';

  return {
    leagueId: league.leagueId,
    partnerFranchiseId: partnerId,
    partnerName: partner.name || 'Their team',
    send: send.map((a) => ({ id: a.id, name: a.name, position: a.position, value: a.value, kind: a.kind })),
    sendValue,
    ask: ask.map((a) => ({ id: a.id, name: a.name, position: a.position, value: a.value, bait: !!a.bait, tag: a.tag || null, kind: a.kind })),
    askValue,
    verdict,
    myNeeds: [...myNeeds],
    format: leagueFormat.label(data.fmt),
  };
}

// A full deal from ZERO with `partnerFranchiseId`: propose BOTH sides at once. Acquire one of their
// players that fills YOUR need (preferring their surplus + trade bait — the ones they'll move), and
// pay for it with a fair package from your side biased to THEIR needs + your bait. Considers the
// strongest few targets and returns the best-scoring, needs-fitting, fair deal. Never ships your
// Targets or acquires your Avoids if avoidable.
async function fullDealFor(cookie, token, leagueId, partnerFranchiseId) {
  const data = await tradeData(cookie, token, leagueId);
  const { league, byId, enr, roster, rawPartners, ns } = data;
  const partnerId = String(partnerFranchiseId || '');
  const partner = rawPartners.find((p) => String(p.franchiseId) === partnerId);
  if (!partner) { const e = new Error('That team is not in this league.'); e.status = 404; throw e; }
  const myFid = String(league.franchiseId);

  const myIds = new Set([...roster.starters, ...roster.bench].map((p) => String(p.id)));
  const mine = [...roster.starters, ...roster.bench].map((p) => ({ id: String(p.id), name: p.name, position: p.position, value: enr.value(p.id) || 0, tag: playerTags.get(token, p.id) || null }));

  const baitMap = await tradeBaitByFranchise(cookie, token, league);
  const myBait = baitMap.get(myFid) || new Set();
  const theirBait = baitMap.get(partnerId) || new Set();

  const myNeeds = (ns[myFid] || {}).needs || [];
  const myNeedSet = new Set(myNeeds.map((x) => x.pos));
  const partnerNeeds = (ns[partnerId] || {}).needs || [];
  const partnerNeedSet = new Set(partnerNeeds.map((x) => x.pos));
  const partnerSurplusSet = new Set(((ns[partnerId] || {}).surplus || []).map((x) => x.pos));

  // Their acquirable players (value>0, not mine). Picks aren't targets here — we deal for players.
  const theirPool = (partner.roster || [])
    .map((id) => { const a = asset(id, byId, enr); a.tag = playerTags.get(token, a.id) || null; a.bait = theirBait.has(String(a.id)); return a; })
    .filter((a) => a.kind === 'player' && (a.value || 0) > 0 && !myIds.has(String(a.id)));
  if (!theirPool.length || !mine.length) { const e = new Error('Not enough tradeable pieces to build a deal.'); e.status = 422; throw e; }

  // How much I'd want to acquire each of their players.
  const targetScore = (a) => {
    let s = 0;
    if (myNeedSet.has(a.position)) s += 45; // fills MY need
    if (partnerSurplusSet.has(a.position)) s += 20; // from THEIR surplus — they can spare it
    if (a.bait) s += 25; // they're shopping him
    if (a.tag === 'target') s += 30; else if (a.tag === 'avoid') s -= 50;
    return s;
  };
  const candidates = theirPool.slice().sort((a, b) => targetScore(b) - targetScore(a) || (b.value || 0) - (a.value || 0)).slice(0, 5);

  // Score a full deal (a target + the give-package that pays for it).
  const dealScore = (target, give) => {
    const rv = target.value || 0;
    const sv = give.reduce((s, g) => s + (g.value || 0), 0);
    const scaleV = Math.max(rv, sv, 1);
    let s = -(Math.abs(rv - sv) / scaleV) * 40; // fairness — the closer the better
    if (myNeedSet.has(target.position)) s += 45; // I fill a need
    if (give.some((g) => partnerNeedSet.has(g.position))) s += 30; // they fill a need
    if (target.bait) s += 20;
    if (give.some((g) => myBait.has(String(g.id)))) s += 15;
    if (target.tag === 'target') s += 20;
    if (give.some((g) => g.tag === 'target')) s -= 40; // protect my Targets
    if (give.some((g) => g.tag === 'avoid')) s += 10; // glad to move my Avoids
    return s;
  };

  let best = null;
  for (const target of candidates) {
    const give = tradefit.suggestGive(mine.filter((m) => String(m.id) !== String(target.id)), target.value || 0, partnerNeeds, myBait);
    if (!give.length) continue;
    const score = dealScore(target, give);
    if (!best || score > best.score) best = { target, give, score };
  }
  if (!best) { const e = new Error('Could not build a fair deal with this team.'); e.status = 422; throw e; }

  const val = (arr) => Math.round(arr.reduce((s, a) => s + (a.value || 0), 0) * 10) / 10;
  const receive = [best.target];
  const send = best.give;
  const receiveValue = val(receive);
  const sendValue = val(send);
  const scaleV = Math.max(receiveValue, sendValue, 1);
  const diff = receiveValue - sendValue;
  const verdict = diff > 0.08 * scaleV ? 'favorable' : diff < -0.08 * scaleV ? 'light' : 'fair';

  const givesTheir = [...new Set(send.filter((g) => partnerNeedSet.has(g.position)).map((g) => g.position))];
  const bits = [];
  bits.push(myNeedSet.has(best.target.position) ? `lands a ${best.target.position} at your need` : `adds ${best.target.name.split(',')[0]} (${best.target.position})`);
  if (givesTheir.length) bits.push(`sends ${givesTheir.join('/')} they're light at`);
  if (best.target.bait) bits.push('he’s on their block');
  const rationale = bits.join(' · ');

  const fmt = (a, baitSet) => ({ id: a.id, name: a.name, position: a.position, value: a.value, bait: baitSet.has(String(a.id)), tag: a.tag || null, kind: a.kind });
  return {
    leagueId: league.leagueId,
    partnerFranchiseId: partnerId,
    partnerName: partner.name || 'Their team',
    receive: receive.map((a) => fmt(a, theirBait)),
    receiveValue,
    send: send.map((a) => fmt(a, myBait)),
    sendValue,
    verdict,
    rationale,
    myNeeds: [...myNeedSet],
    partnerNeeds: [...partnerNeedSet],
    format: leagueFormat.label(data.fmt),
  };
}

// The "ask for a little more" sweetener when an incoming offer is already fair or in
// your favor: the partner's nearest-year 3rd rookie pick, or a 4th if they hold no 3rd.
// Skips any pick already in the deal. Returns null when they have neither to give.
function pickSweetener(partnerPicks, alreadyInDeal) {
  const have = new Set([...alreadyInDeal].map((a) => String(a.id)));
  const byYearThenRound = (a, b) => (a.year || 9999) - (b.year || 9999) || (a.round || 9) - (b.round || 9);
  const eligible = (partnerPicks || []).filter((p) => p.token && !have.has(String(p.token)));
  const thirds = eligible.filter((p) => p.round === 3).sort(byYearThenRound);
  if (thirds.length) return thirds[0];
  const fourths = eligible.filter((p) => p.round === 4).sort(byYearThenRound);
  return fourths[0] || null;
}

// A COUNTER to an incoming offer: keep the offer's construction (same players, same
// shape). If their offer leaves you light, rebalance to fair — ask for one more of
// their players (preferring one on THEIR trade bait, or at YOUR need) else trim your
// give. If the offer is already fair or in your favor, don't just re-send it: ask for
// a small sweetener (their nearest 3rd rookie pick, a 4th if no 3rd). Either way you
// come out at/above fair.
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

  // Offer was already fair-or-better and we didn't need to rebalance → sweeten it a
  // touch rather than re-sending the same deal.
  let sweetener = null;
  if (!added.length && val(receive) - val(give) >= -FAIR * scale()) {
    try {
      const partnerPicks = await picksLib.franchisePicks(cookie, league, partnerId);
      sweetener = pickSweetener(partnerPicks, receive);
      if (sweetener) {
        const a = asset(sweetener.token, byId, enr);
        a.bait = theirBait.has(String(a.id));
        receive.push(a);
      }
    } catch (e) { /* no sweetener available — send the fair deal as-is */ }
  }

  const net = val(receive) - val(give);
  const short = Math.abs(Math.round(offer.analysis.net));
  // `mode` drives the button label on the inbox: what the counter actually did.
  let rationale;
  let mode;
  if (sweetener) {
    mode = 'sweeten';
    rationale = `Their offer was already fair to you — this counter keeps it and asks for a little more: their ${sweetener.label}.`;
  } else if (added.length) {
    mode = 'balance';
    const names = added.map((a) => a.name.split(',')[0]).join(' + ');
    const baited = added.some((a) => theirBait.has(String(a.id)));
    rationale = `Their offer left you about ${short} light. Counter keeps the same shape but also asks for ${names}${baited ? ' (on their block)' : ''}.`;
  } else if (net >= 0) {
    mode = 'fair';
    rationale = 'Their offer is already fair to you — sent back as-is to lock it in.';
  } else {
    mode = 'nudge';
    rationale = 'Kept the same shape; nudge it from here.';
  }

  return {
    leagueId: league.leagueId,
    counterOfferId: String(offer.id),
    toFranchiseId: partnerId,
    partnerName: offer.withName,
    mode,
    give: give.map((a) => ({ id: a.id, name: a.name, position: a.position, kind: a.kind, value: a.value })),
    receive: receive.map((a) => ({ id: a.id, name: a.name, position: a.position, kind: a.kind, value: a.value, bait: theirBait.has(String(a.id)) })),
    giveValue: val(give),
    receiveValue: val(receive),
    rationale,
  };
}

// Respond to a pending trade offer. MFL's tradeResponse RESPONSE has three values:
//   accept / reject — allowed only for the TARGET of an incoming offer,
//   revoke          — allowed only for the ORIGINATOR of an outgoing offer (withdraw it).
// `comments` is an optional note MFL delivers to the originator when the offer is REJECTED.
const RESPONSE_STATUS = { accept: 'accepted', reject: 'rejected', revoke: 'revoked' };
async function respond(cookie, token, leagueId, tradeId, action, comments) {
  const act = action === 'accept' ? 'accept' : action === 'revoke' ? 'revoke' : 'reject';
  // Never send MFL a blank/placeholder trade id — that could hit the wrong pending trade.
  if (tradeId == null || tradeId === '' || tradeId === 'null' || tradeId === 'undefined') {
    throwBad('This offer is missing its trade id, so it can’t be responded to here — open it in MyFantasyLeague.');
  }
  const league = await findLeague(cookie, leagueId);
  if (!config.demoMode) {
    try {
      const params = { host: league.host, cookie, L: league.leagueId, FRANCHISE: league.franchiseId, TRADE_ID: tradeId, RESPONSE: act };
      // MFL only delivers COMMENTS on a rejection (the note goes to the originator); ignore it otherwise.
      if (act === 'reject' && comments) params.COMMENTS = String(comments);
      await mfl.importRequest('tradeResponse', params);
    } catch (e) {
      // Surface MFL's ACTUAL reason (hard-won rule — never a bare status), and log it so a rejected
      // accept/reject/revoke is diagnosable. A successful response returns "OK", which importRequest
      // already treats as success, so reaching here means a real rejection (stale trade, not the
      // originator/target for this RESPONSE, no longer valid, …).
      const detail = mfl.errorDetail(e);
      console.warn(`[trades] tradeResponse rejected — L=${league.leagueId} trade=${tradeId} response=${act} — ${detail}`);
      const err = new Error(`MyFantasyLeague couldn’t ${act} the trade: ${detail}`);
      err.status = e.status || 502;
      err.detail = detail;
      throw err;
    }
    // Accepted, rejected, OR revoked, the trade is no longer PENDING on MFL. The inbox is built from
    // MFL's pendingTrades, which we cache (~12s), so without this the app's immediate refetch would
    // re-serve the pre-response snapshot and the resolved offer would linger on the Trades screen.
    // Drop this league's cached reads so the reload reflects the removal right away.
    mfl.invalidateLeague(cookie, league.leagueId);
  }
  const seed = config.demoMode ? demo.tradeOffers(leagueId) : [];
  tradeStore.resolve(token, leagueId, seed, tradeId, RESPONSE_STATUS[act]);
  // Accepting a trade also changes my roster on MFL — drop the cached roster so the next read
  // reflects it, and the Players tab's cross-league map with it. (Reject/revoke don't touch rosters.)
  // Lazy require avoids a playerhub↔trades cycle.
  if (act === 'accept') {
    rosterService.invalidate(cookie, leagueId);
    require('./playerhub').invalidateGather(cookie);
  }
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
      // Surface MFL's actual complaint (via the shared errorDetail: mflError > body > message)
      // instead of a bare status code, and log the exact asset lists so a rejected proposal is
      // diagnosable. A successful proposal returns "OK", which importRequest treats as success.
      const detail = mfl.errorDetail(e);
      // eslint-disable-next-line no-console
      console.warn('[trades] tradeProposal rejected', JSON.stringify({
        L: league.leagueId, FRANCHISE: league.franchiseId, OFFEREDTO: toFranchiseId,
        WILL_GIVE_UP: willGiveUp, WILL_RECEIVE: willReceive, status: e.status, detail,
      }));
      const err = new Error(`MyFantasyLeague rejected the proposal: ${detail}`);
      err.status = e.status || 502;
      err.detail = detail;
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
async function crossLeaguePreview(cookie, token, targetId, leagueIds) {
  const tid = String(targetId);
  let leagues = await leaguesService.listLeagues(cookie);
  // The caller (player profile) already knows the leagues where he's a trade target — pass
  // them so we probe ONLY those. Probing every league meant a full roster + all-franchise read
  // per league just to discard the ones where he's already yours or a free agent.
  if (Array.isArray(leagueIds) && leagueIds.length) {
    const want = new Set(leagueIds.map(String));
    leagues = leagues.filter((l) => want.has(String(l.leagueId)));
  }
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
        return { leagueId: s.leagueId, ok: false, error: mfl.errorDetail(e) };
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

// Just the "start a trade here" fit hint for ONE league. The needs/surplus read is
// the expensive part, so the inbox returns offers immediately and the client fetches
// this per league in the background — spreading the MFL load instead of paying it all
// up front (which is why the hint used to only appear on leagues that had an offer).
// The "deep at X · N rivals need it" hint. It runs the full per-league tradeData (every franchise's
// roster → needs/surplus), so it's expensive — and the inbox asks for it once PER LEAGUE. Memoize the
// result (~20m): needs/surplus only shifts on adds/drops/trades, so a many-league user re-opening the
// tab (or the client re-driving the fan-out) gets instant hits instead of recomputing 15 heavy reads.
// A FAILED fit is NOT cached (the memo drops a rejected produce), so a transient throttle is retried.
const fitMemo = createMemo({ ttlMs: 20 * 60 * 1000 });
async function getLeagueFit(cookie, token, leagueId) {
  try {
    return await fitMemo.get(`${cookie || ''}:${leagueId}`, async () => {
      const d = await tradeData(cookie, token, leagueId);
      return { leagueId: String(leagueId), fit: tradeFitSummary(d.ns, d.league.franchiseId) };
    });
  } catch (e) {
    return { leagueId: String(leagueId), fit: null }; // not memoized — retried on the next request
  }
}

// The league's trade deadline from MFL's `calendar` export. MFL's calendarEvent reference is
// explicit that the trade-deadline event type is **`TRADE`** (confirmed against a live calendar —
// the earlier `TRADE_DEADLINE` guess would silently miss it); the epoch-seconds `start_time` is the
// deadline. Kept the `TRADE_DEADLINE`/`TRADEDEADLINE` and label variants as defensive fallbacks
// (e.g. a CUSTOM event titled "Trade Deadline"). Returns the soonest future deadline in ms, or null.
const TRADE_DEADLINE_TYPES = new Set(['TRADE', 'TRADE_DEADLINE', 'TRADEDEADLINE']);
async function nextTradeDeadline(cookie, league) {
  try {
    const events = await mflRepo.calendar(league, cookie);
    const now = Date.now();
    let soonest = null;
    for (const ev of events) {
      const type = mfl.text(ev.type).toUpperCase();
      const label = `${mfl.text(ev.title)} ${mfl.text(ev.description)}`.toUpperCase();
      const isDeadline =
        TRADE_DEADLINE_TYPES.has(type) ||
        (/TRADE/.test(label) && /DEADLINE/.test(label));
      if (!isDeadline) continue;
      const startSec = mfl.num(ev.start_time);
      if (!Number.isFinite(startSec) || startSec <= 0) continue;
      const t = startSec * 1000;
      if (t >= now && (soonest == null || t < soonest)) soonest = t;
    }
    return soonest;
  } catch (e) {
    return null;
  }
}

// A league's effective trade deadline, resolved once for every surface that needs it
// (On Deck, the Home/league-card countdown chip). Precedence: a manual override the owner
// set, else the demo fixture (demo mode) or MFL's league calendar (live). Returns
// { at: ms, date: 'YYYY-MM-DD', source } or null when there's none upcoming.
async function effectiveDeadline(cookie, token, league) {
  const manual = tradeDeadlines.get(token, league.leagueId);
  if (manual) {
    const ms = new Date(`${manual}T23:59:59Z`).getTime();
    return Number.isNaN(ms) ? null : { at: ms, date: manual, source: 'manual' };
  }
  if (config.demoMode) {
    const d = demo.tradeDeadline(league.leagueId);
    if (!d) return null;
    return { at: new Date(`${d}T23:59:59Z`).getTime(), date: d, source: 'demo' };
  }
  const ms = await nextTradeDeadline(cookie, league).catch(() => null);
  if (!ms) return null;
  return { at: ms, date: new Date(ms).toISOString().slice(0, 10), source: 'mfl' };
}

// Greedily pack the highest-value assets from `assets` until their sum reaches `target` (the minimal
// over-the-target set, or all of them if they can't reach it). Used to seed a fair pick/player package
// for the Pick Capital shop/acquire flows — a starting point the owner tweaks on the desk.
function packToValue(assets, target) {
  const sorted = assets.slice().filter((a) => (a.value || 0) > 0).sort((a, b) => (b.value || 0) - (a.value || 0));
  const out = [];
  let sum = 0;
  for (const a of sorted) {
    if (sum >= target && out.length) break;
    out.push(a);
    sum += a.value || 0;
  }
  return { assets: out, value: sum };
}

// Pick-oriented partner targeting — the engine behind the Pick Capital dashboard's shop/acquire flows.
// Given an INTENT for ONE league, rank the rivals as trade partners and pre-build a suggested deal:
//   • 'shop'    — cash draft picks for a proven player. Best partners are REBUILDING teams holding an
//                 aging-but-valuable vet (they crave picks; I crave their win-now asset). Suggested
//                 deal: I SEND picks (~ the vet's value), I RECEIVE that vet.
//   • 'acquire' — accumulate picks. Best partners are WIN-NOW teams sitting on pick equity (they'll
//                 spend picks on a proven player). Suggested deal: I SEND a player they need (~ their
//                 best pick's value), I RECEIVE that pick.
// Reuses the desk's building blocks: tradeData (rosters/values/needs/outlook), assetsByFranchise (pick
// equity), asset()/analyze(). Returns ranked partners, each with a ready-to-open, value-balanced deal.
async function pickPartners(cookie, token, leagueId, intent) {
  const mode = intent === 'shop' ? 'shop' : 'acquire';
  const data = await tradeData(cookie, token, leagueId);
  const { league, byId, enr, roster, rawPartners, ns, teamOutlook } = data;
  const myFid = String(league.franchiseId);
  const [assetsMap, demoMyPicks] = await Promise.all([
    picksLib.assetsByFranchise(cookie, league).catch(() => null),
    // Demo has no `assets` export, so seed MY picks from the fixture (partners' picks stay empty in demo).
    config.demoMode ? picksLib.franchisePicks(cookie, league).catch(() => []) : Promise.resolve(null),
  ]);
  const picksAssetsFor = (fid) => {
    const fromAssets = assetsMap && (assetsMap[String(fid)] || assetsMap[mfl.fid(fid)]);
    if (fromAssets) return fromAssets.map((p) => asset(p.token, byId, enr)).filter((a) => a.kind === 'pick');
    if (config.demoMode && String(fid) === myFid && demoMyPicks) return demoMyPicks.map((p) => asset(p.token, byId, enr)).filter((a) => a.kind === 'pick');
    return [];
  };

  const myPlayers = [...(roster.starters || []), ...(roster.bench || [])]
    .map((p) => asset(p.id, byId, enr)).filter((a) => a.value != null);
  const myPicks = picksAssetsFor(myFid);
  const myNeeds = (ns[myFid] || {}).needs || [];
  const OLD_AGE = 26; // "aging vet" floor — a productive player past his dynasty-value peak

  const rows = [];
  for (const pt of rawPartners) {
    const fid = String(pt.franchiseId);
    const ol = teamOutlook[fid] || {};
    const outlook = ol.outlook || null;
    const theirNeeds = (ns[fid] || {}).needs || [];
    const theirPicks = picksAssetsFor(fid);
    let deal = null;
    let fit = 0;
    let reason = '';

    if (mode === 'acquire') {
      // Win-now teams with pick equity: target their best pick, pay with a player they need. A
      // REBUILDING team hoards its picks, so it's never an acquire target — skip it.
      const bestPick = theirPicks.slice().sort((a, b) => (b.value || 0) - (a.value || 0))[0];
      if (!bestPick || outlook === 'Rebuilding') continue;
      const pickEquity = theirPicks.reduce((s, p) => s + (p.value || 0), 0);
      const preferred = myPlayers.filter((p) => theirNeeds.includes(p.position));
      const send = packToValue(preferred.length ? preferred : myPlayers, bestPick.value || 0);
      if (!send.assets.length) continue;
      const winNow = outlook === 'Win-now window';
      fit = (winNow ? 100 : outlook === 'Balanced' ? 40 : 20) + Math.min(60, pickEquity / 3) + (preferred.length ? 15 : 0);
      reason = `${winNow ? 'Win-now' : outlook || 'This'} team · ${theirPicks.length} pick${theirPicks.length === 1 ? '' : 's'} in hand${preferred.length ? ` · thin at ${theirNeeds[0]}` : ''}`;
      deal = { send: send.assets, receive: [bestPick] };
    } else {
      // Rebuilding teams with an aging, still-valuable vet: target that vet, pay with my picks. Only a
      // genuine aging asset qualifies — a young stud isn't a "shop my picks" target, and a WIN-NOW team
      // won't sell its vets — so require an old-enough, valuable vet on a non-win-now team.
      if (!myPicks.length || outlook === 'Win-now window') continue;
      const theirPlayers = (pt.roster || []).map((id) => ({ ...asset(id, byId, enr), age: enr.age(id) }))
        .filter((a) => a.kind === 'player' && a.value != null);
      const vets = theirPlayers.filter((p) => (p.age || 0) >= OLD_AGE && (p.value || 0) >= 15);
      if (!vets.length) continue;
      const target = vets.slice().sort((a, b) => (b.value || 0) - (a.value || 0))[0];
      const send = packToValue(myPicks, target.value || 0);
      if (!send.assets.length) continue;
      const rebuilding = outlook === 'Rebuilding';
      fit = (rebuilding ? 100 : outlook === 'Balanced' ? 40 : 20) + Math.min(60, (target.value || 0) / 3) + ((target.age || 0) >= OLD_AGE ? 20 : 0);
      reason = `${rebuilding ? 'Rebuilding' : outlook || 'This'} team · ${target.name.split(',')[0]}${target.age ? ` (${target.age})` : ''} could be had for picks`;
      deal = { send: send.assets, receive: [{ id: target.id, name: target.name, position: target.position, kind: 'player', value: target.value }] };
    }

    // Value verdict from MY perspective (acquire = what I receive), same math as the desk preview.
    const analysis = analyze(deal.receive, deal.send);
    const strip = (a) => ({ id: a.id, name: a.name, position: a.position, kind: a.kind, value: a.value });
    rows.push({
      franchiseId: fid,
      name: pt.name,
      outlook,
      avgAge: ol.avgAge != null ? ol.avgAge : null,
      reason,
      fit: Math.round(fit),
      deal: {
        send: deal.send.map(strip),
        receive: deal.receive.map(strip),
        sendValue: analysis.sendValue,
        receiveValue: analysis.acquireValue,
        verdict: analysis.verdict,
      },
    });
  }
  rows.sort((a, b) => b.fit - a.fit);
  return {
    leagueId: league.leagueId,
    name: league.name,
    intent: mode,
    myNeeds,
    partners: rows.slice(0, 6),
  };
}

module.exports = { getOverview, getLeague, getLeagueFit, respond, propose, analyze, crossLeaguePreview, crossLeaguePropose, suggestFor, askFor, fullDealFor, counterFor, pickPartners, nextTradeDeadline, effectiveDeadline, tradeFitSummary, tradeBaitByFranchise, personalAnalyze, tagNotes };
