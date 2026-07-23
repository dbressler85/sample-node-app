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
const enrichmentLib = require('../lib/enrichment');
const leagueFormat = require('../lib/leagueformat');
const playersLib = require('../lib/players');
const picksLib = require('../lib/picks');
const leaguesService = require('./leagues');
const rosterService = require('./roster');
const draftService = require('./draft');
const tradeStore = require('../store/trades');
const playerTags = require('../store/playerTags');
const baitStore = require('../store/tradebait');
const tradefit = require('../lib/tradefit');
const tradeMath = require('../lib/tradeMath');
const season = require('../lib/season');

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

// Pick value comes from the shared model in lib/picks (picksLib.value) so the roster's pick
// chips and the trade desk always agree. Kept as a thin local alias for readability below.
function pickValue(label) {
  return picksLib.value(label);
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
    return { kind: 'faab', id: t, name: faabLabel(bb), position: 'FAAB', team: null, amount: bb, value: faabValue(bb) };
  }
  if (t.startsWith('pick:') || t.startsWith('FP_') || t.startsWith('DP_')) {
    const label = t.startsWith('pick:') ? t.slice(5) : picksLib.labelForToken(t);
    return { kind: 'pick', id: t, name: label, position: 'PICK', team: null, value: pickValue(label) };
  }
  const p = playersLib.resolve(byId, t);
  return { kind: 'player', id: p.id, name: p.name, position: p.position, team: p.team, value: enr.value(p.id) };
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
function annotateConstruction(offers, ns, franchiseId) {
  const mine = ns[String(franchiseId)] || { needs: [], surplus: [], depth: {} };
  for (const o of offers) {
    o.construction = tradefit.constructionVerdict(o.send, o.acquire, mine.needs, mine.surplus, 'you', mine.depth);
    const theirs = o.withFranchiseId ? ns[String(o.withFranchiseId)] : null;
    if (theirs) o.partnerConstruction = tradefit.constructionVerdict(o.acquire, o.send, theirs.needs, theirs.surplus, 'they', theirs.depth);
    o.bottomLine = bottomLine(o.analysis && o.analysis.verdict, o.construction && o.construction.rating);
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
    // an owner's cookie already scopes the response to their own franchise).
    const list = await mflRepo.pendingTrades(league, cookie, { FRANCHISE_ID: league.franchiseId });
    if (!list.length) return [];
    const names = await leaguesService.franchiseNames(cookie, league);
    const toks = (v) => String(v || '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    return list
      .filter((tr) => String(mfl.attr(tr, 'offeredto')) === league.franchiseId)
      .map((tr, i) => {
        const from = String(mfl.attr(tr, 'offeringteam') || '');
        // The trade id is what tradeResponse targets — accepting/rejecting the WRONG id (or a
        // made-up one) is the worst failure mode here, so extract it explicitly and never fall
        // back to an array index. If MFL doesn't give one, log the raw keys (so we can see the
        // real field name) and leave id null — the UI keeps the offer visible but read-only.
        const tradeId = mfl.attr(tr, 'trade_id', 'id', 'tradeid');
        if (tradeId == null) console.warn(`[trades] pendingTrade with no trade_id (L=${league.leagueId}); attrs: ${Object.keys(tr || {}).join(',')}`);
        return {
          id: tradeId != null ? String(tradeId) : null,
          direction: 'incoming',
          status: 'pending',
          withFranchiseId: from,
          withName: names.get(from) || 'Another team',
          expires: mfl.attr(tr, 'expires') || null,
          comments: mfl.attr(tr, 'comments', 'message') || null,
          // MFL names these `will_give_up` / `will_receive` (snake_case) here — the
          // receive side previously only checked camelCase, so what you'd give up
          // came back empty ("You give · 0"). attr() matches any casing.
          acquire: toks(mfl.attr(tr, 'willgiveup')),
          send: toks(mfl.attr(tr, 'willreceive', 'willreceiveinreturn')),
        };
      });
  } catch (e) {
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
          annotateConstruction(offers, d.ns, league.franchiseId);
          fit = tradeFitSummary(d.ns, league.franchiseId);
          // Both sides' dynasty context so the inbox shows each team's outlook + age.
          const meCtx = d.teamOutlook[String(league.franchiseId)] || null;
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
  const [roster, rawPartners, requirements] = await Promise.all([
    rosterService.getRoster(cookie, leagueId).catch((e) => { console.warn(`[trades] getRoster failed for L=${leagueId}: ${e.message}`); return EMPTY_ROSTER; }),
    (config.demoMode ? Promise.resolve(demo.tradePartners(leagueId)) : liveRosters(cookie, league)).catch(() => []),
    leagueFormat.requirements(cookie, league).catch(() => []),
  ]);

  const myPlayersAll = [...(roster.starters || []), ...(roster.bench || [])];
  // Every franchise's players as { id, position, value, age } — value+age drive the
  // needs/surplus model AND the per-team dynasty outlook / average age below.
  const franchises = [
    { franchiseId: String(league.franchiseId), players: myPlayersAll.map((p) => ({ id: p.id, position: p.position, value: enr.value(p.id), age: enr.age(p.id) })) },
    ...rawPartners.map((pt) => ({
      franchiseId: String(pt.franchiseId),
      players: (pt.roster || []).map((id) => { const b = playersLib.resolve(byId, id); return { id: String(id), position: b.position, value: enr.value(id), age: enr.age(id) }; }),
    })),
  ];
  const ns = tradefit.needsSurplus(franchises, requirements);
  const teamOutlook = summarizeFranchises(franchises);
  return { league, byId, enr, roster, rawPartners, requirements, ns, teamOutlook, fmt };
}

// Dynasty outlook (win-now / ascending / rebuilding / balanced) + average roster age for
// every franchise, so the trade desk can show BOTH teams' status and reveal an owner who
// skews young or old. Reuses the roster summary's coreAge/strength → outlook rule.
function summarizeFranchises(franchises) {
  const totals = franchises.map((f) => ({ id: String(f.franchiseId), total: (f.players || []).reduce((s, p) => s + (p.value || 0), 0) }));
  const out = {};
  for (const f of franchises) {
    const valued = (f.players || []).filter((p) => p.value != null);
    const avgAge = valued.length ? Math.round((valued.reduce((s, p) => s + (p.age || 0), 0) / valued.length) * 10) / 10 : null;
    const core = valued.slice().sort((a, b) => b.value - a.value).slice(0, 5);
    const coreAge = core.length ? Math.round((core.reduce((s, p) => s + (p.age || 0), 0) / core.length) * 10) / 10 : null;
    const myTotal = (totals.find((t) => t.id === String(f.franchiseId)) || {}).total || 0;
    const strengthPct = totals.length > 1 && myTotal ? totals.filter((t) => t.total <= myTotal).length / totals.length : null;
    out[String(f.franchiseId)] = { outlook: rosterService.computeOutlook(coreAge, strengthPct), avgAge };
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
  const [rawLeagueOffers, baitMap, picksMap, upcoming, demoMyPicks] = await Promise.all([
    offersForLeague(cookie, token, league, byId, enr).catch((e) => { console.warn(`[trades] offersForLeague failed for L=${leagueId}: ${e.message}`); return []; }),
    tradeBaitByFranchise(cookie, token, league).catch(() => new Map()),
    picksLib.franchisePicksMap(cookie, league).catch(() => ({})),
    draftService.upcomingPicksByFranchise(cookie, token, league).catch(() => ({})),
    (config.demoMode ? picksLib.franchisePicks(cookie, league) : Promise.resolve(null)).catch(() => null),
  ]);

  const offers = annotateConstruction(rawLeagueOffers, ns, league.franchiseId);
  const myBait = baitMap.get(String(league.franchiseId)) || new Set();
  const picksFor = (fid) => (picksMap[String(fid)] || []).map((p) => asset(p.token, byId, enr));
  const upcomingFor = (fid) => (upcoming[String(fid)] || []).map((p) => asset(p.token, byId, enr));

  const myPlayers = [...(roster.starters || []), ...(roster.bench || [])]
    .map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, value: enr.value(p.id), tag: playerTags.get(token, p.id), bait: myBait.has(String(p.id)) }))
    .sort((a, b) => (b.value || 0) - (a.value || 0));
  // Picks carry the real MFL trade token as their id, so a proposal can include them.
  const myFuturePicks = config.demoMode ? (demoMyPicks || []).map((p) => asset(p.token, byId, enr)) : picksFor(league.franchiseId);
  // Current-year picks first (the draft that hasn't happened), then future-season picks.
  const myPicks = [...upcomingFor(league.franchiseId), ...myFuturePicks];

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
      players: [...rosterPlayers, ...upcomingFor(pt.franchiseId), ...picksFor(pt.franchiseId)],
    };
  });

  const mine = ns[String(league.franchiseId)] || { needs: [], surplus: [], depth: {} };
  const myOutlook = teamOutlook[String(league.franchiseId)] || {};
  return {
    leagueId: league.leagueId,
    name: league.name,
    offers,
    myPlayers,
    myPicks,
    partners,
    me: { name: roster.franchiseName || 'My Team', outlook: myOutlook.outlook || null, avgAge: myOutlook.avgAge || null, needs: mine.needs, surplus: mine.surplus, depth: mine.depth },
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

// Accept or reject a pending incoming offer.
async function respond(cookie, token, leagueId, tradeId, action) {
  const act = action === 'accept' ? 'accept' : 'reject';
  // Never send MFL a blank/placeholder trade id — that could hit the wrong pending trade.
  if (tradeId == null || tradeId === '' || tradeId === 'null' || tradeId === 'undefined') {
    throwBad('This offer is missing its trade id, so it can’t be accepted or rejected here — open it in MyFantasyLeague.');
  }
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
  // read reflects it, and the Players tab's cross-league map with it. (Rejecting
  // changes nothing.) Lazy require avoids a playerhub↔trades cycle.
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
async function getLeagueFit(cookie, token, leagueId) {
  try {
    const d = await tradeData(cookie, token, leagueId);
    return { leagueId: String(leagueId), fit: tradeFitSummary(d.ns, d.league.franchiseId) };
  } catch (e) {
    return { leagueId: String(leagueId), fit: null };
  }
}

module.exports = { getOverview, getLeague, getLeagueFit, respond, propose, analyze, crossLeaguePreview, crossLeaguePropose, suggestFor, counterFor, tradeFitSummary, tradeBaitByFranchise, personalAnalyze, tagNotes };
