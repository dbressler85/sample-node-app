import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Modal, Animated, KeyboardAvoidingView, Platform } from 'react-native';
import { appAlert } from "../components/AppAlert";
import { useRequirePro } from '../entitlement';
import { api } from '../api';
import tradeMath from '../tradeMath';
import { colors, positionColors, size, space } from '../theme';
import { displayLabel } from '../typography';
import Button from '../components/Button';
import { GlyphMark } from '../components/NeonGlyphs';
import { TopbarTitle } from '../components/Brand';
import { celebrate } from '../components/Celebrate';
import { toast } from '../components/Toast';
import TradeColumns from '../components/TradeColumns';
import ValueCredit from '../components/ValueCredit';
import Reveal from '../components/Reveal';
import NeonSign from '../components/NeonSign';
import useActFlash from '../useActFlash';
import useAndroidBack from '../useAndroidBack';
import { peekResource, primeResource } from '../useCachedResource';
import { getValue, setValue } from '../cache';
import { STALE } from '../staleTiers';

const posList = (arr) => (arr && arr.length ? arr.map((x) => x.pos).join(', ') : '—');

// Sortable asset lists on the offer builder. Position groups run QB→RB→WR→TE→K/DEF→picks
// (picks last), value within a group descending; value sorts high→low; name A→Z.
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, PK: 4, DEF: 5, PICK: 9 };
// Draft-order rank for a pick from its label ("2026 1.03" resolved, or "2027 1st" generic) so picks
// list in real chronological order (year → round → slot) instead of by dynasty value — which had
// 1.10 landing above 1.03 and the round-midpoint-priced generic picks wedged between resolved slots.
// A generic pick with no known slot sorts AFTER the resolved slots of its round.
function pickOrder(name) {
  const s = String(name || '');
  const year = (/(20\d{2})/.exec(s) || [])[1];
  const slot = /\b(\d+)\.(\d{1,2})\b/.exec(s); // "1.03"
  const ord = /(\d+)\s*(?:st|nd|rd|th)/i.exec(s); // "1st"
  const round = slot ? Number(slot[1]) : ord ? Number(ord[1]) : 99;
  const pick = slot ? Number(slot[2]) : 50; // unresolved slot → after this round's known slots
  return (year ? Number(year) : 9999) * 10000 + round * 100 + pick;
}
function sortAssets(list, key) {
  const arr = [...(list || [])];
  if (key === 'name') return arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (key === 'value') return arr.sort((a, b) => (b.value || 0) - (a.value || 0));
  return arr.sort((a, b) => {
    const pa = POS_ORDER[a.position] != null ? POS_ORDER[a.position] : 6;
    const pb = POS_ORDER[b.position] != null ? POS_ORDER[b.position] : 6;
    if (pa !== pb) return pa - pb;
    // Within the picks bucket, order by draft position, not value.
    if (a.position === 'PICK' && b.position === 'PICK') return pickOrder(a.name) - pickOrder(b.name);
    return (b.value || 0) - (a.value || 0);
  });
}
const SORTS = [['position', 'Pos'], ['value', 'Market'], ['name', 'Name']];
const CONSTRUCTION = {
  good: { color: colors.good, icon: '✓' },
  caution: { color: colors.warn, icon: '⚠' }, // a cautionary roster read is a warning (orange), not a hard no (red)
  neutral: { color: colors.textDim, icon: '•' },
};

// Live roster-construction read for the builder. The RATING comes from the shared trade-math
// module (single source with the backend — the verdict can't disagree); the terse chip wording
// below is the mobile side's own. give/receive are asset lists from THIS team's side.
function constructionOf(give, receive, needs, surplus, subject, posDepth) {
  const { rating, branch, you, fills, thins, fromDepth, holes } = tradeMath.constructionRating(
    give,
    receive,
    needs,
    surplus,
    subject,
    posDepth
  );
  const j = (a) => a.join('/');
  let reason;
  if (branch === 'hole') reason = you ? `Leaves you with no startable ${j(holes)} — replace the spot first` : `Strips their ${j(holes)} starter`;
  else if (branch === 'thin') reason = you ? `Ships a ${j(thins)} you're thin at` : `Costs them a ${j(thins)} they need`;
  else if (branch === 'fit') reason = you ? (fills.length ? `Fills your ${j(fills)} need${fromDepth.length ? ` from ${j(fromDepth)} depth` : ''}` : `From your ${j(fromDepth)} depth`) : (fills.length ? `Fills their ${j(fills)} need — likely to bite` : `From their ${j(fromDepth)} depth`);
  else if (branch === 'weak') reason = you ? (thins.length ? `Thins your ${j(thins)}` : 'Onto your strength') : (thins.length ? `Thins their ${j(thins)}` : 'Onto their strength');
  else reason = you ? 'Roster-neutral' : 'Neutral for them';
  return { rating, reason };
}

const VERDICT = {
  favorable: { label: 'You gain value', color: colors.good },
  fair: { label: 'Fair deal', color: colors.textDim },
  unfavorable: { label: 'You give up value', color: colors.bad },
};
// Reconciled bottom-line tone → color (value verdict × roster construction).
const TONE = { good: colors.good, warn: colors.warn, bad: colors.bad, neutral: colors.textDim };

// Value analysis (market + personal Target/Avoid lens) comes from the shared trade-math module,
// so the live preview here matches the backend's authoritative verdict on the same deal.

// Compact dynasty outlook for a team header ("Win-now window" -> "Win-now"; the rest are
// already short).
function shortOutlook(o) {
  return o === 'Win-now window' ? 'Win-now' : o || null;
}

// A read on what a partner is likely to want, from their outlook + roster age — so the
// analyzer nudges you toward the right kind of asset (picks/youth vs proven vets).
function partnerTendency(partner) {
  if (!partner) return null;
  const nm = partner.name || 'They';
  if (partner.outlook === 'Win-now window') return `${nm} is win-now — they value proven talent over picks.`;
  if (partner.outlook === 'Rebuilding') return `${nm} is rebuilding — youth and picks appeal more than aging vets.`;
  if (partner.avgAge != null && partner.avgAge <= 24.5) return `${nm} skews young (${partner.avgAge} avg) — older players may not appeal.`;
  if (partner.avgAge != null && partner.avgAge >= 27.5) return `${nm} skews veteran (${partner.avgAge} avg) — likely chasing a title now.`;
  return null;
}

export default function TradesScreen({ league, onBack, initialTab, seed, onOpenPlayer, onSent, onOpenRoster }) {
  const requirePro = useRequirePro();
  // Seed the desk read (partners, my players/picks, offers) from the survive-remount cache, keyed
  // per league — reopening a league's desk paints instantly instead of a cold spinner. In-progress
  // BUILD state (send/receive/faab) is intentionally NOT cached: each open starts a fresh offer.
  const deskKey = `trades:desk:${league.leagueId}`;
  const [data, setData] = useState(() => (peekResource(deskKey) ? peekResource(deskKey).value : null));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(() => !peekResource(deskKey));
  const [tab, setTab] = useState(initialTab === 'propose' ? 'propose' : 'inbox');
  const [busy, setBusy] = useState(null); // offerId being responded to
  const [dismissed, setDismissed] = useState(() => new Set()); // offer ids responded to — hidden immediately (MFL's pending read lags)
  const [rejectTarget, setRejectTarget] = useState(null); // offer being rejected (optional note modal)
  const [rejectNote, setRejectNote] = useState('');
  const [dropTarget, setDropTarget] = useState(null); // { offer, need } — accepting would overflow; pick drops to fit
  const [showCompleted, setShowCompleted] = useState(false); // Sent tab: reveal completed-trade history

  // Propose builder state. Select the partner from any desk data we ALREADY have (survive-remount
  // cache) at first render, preferring the seeded partner — so re-entering from a trade-bait target
  // paints the partner + fit panel immediately instead of showing "Pick a team above" for the
  // seconds the background refetch takes.
  const [partnerId, setPartnerId] = useState(() => {
    const cached = peekResource(deskKey) ? peekResource(deskKey).value : null;
    if (cached && cached.partners && cached.partners.length) {
      return (seed && seed.partnerFranchiseId) || cached.partners[0].franchiseId;
    }
    return null;
  });
  const [send, setSend] = useState({}); // token -> asset
  const [receive, setReceive] = useState({});
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [counterInfo, setCounterInfo] = useState(null); // { offerId, rationale } when countering
  const [dealNote, setDealNote] = useState(null); // { rationale, verdict } from a full-deal suggestion
  const [sortKey, setSortKey] = useState('position'); // offer lists: position | value | name
  const [footerH, setFooterH] = useState(0); // measured height of the absolute propose footer
  const seededRef = useRef(false);
  // Manual trade deadline (MFL exposes none). `undefined` override = use the desk's stored value.
  const [deadlineOverride, setDeadlineOverride] = useState(undefined);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);
  // MFL's own deadline (from the league calendar) shows automatically; a manual entry overrides it.
  const manualDeadline = deadlineOverride !== undefined ? deadlineOverride : (data && data.tradeDeadline) || null;
  const autoDeadline = (data && data.tradeDeadlineAuto) || null;
  const deadline = manualDeadline || autoDeadline;
  const deadlineIsAuto = !manualDeadline && !!autoDeadline;

  async function saveDeadline(value) {
    setSavingDeadline(true);
    try {
      const res = await api.setTradeDeadline(league.leagueId, value);
      setDeadlineOverride(res.deadline);
      setEditingDeadline(false);
    } catch (e) {
      appAlert('Could not save', e.message);
    } finally {
      setSavingDeadline(false);
    }
  }

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.leagueTrades(league.leagueId);
      setData(d);
      primeResource(deskKey, d);
      setValue(deskKey, d); // disk write-through, so reopening a league after an app restart paints instantly
      // Default the partner only if none is chosen — prefer the seeded partner (the
      // team that holds the player you came to trade for), else the first.
      if (d.partners && d.partners.length) setPartnerId((cur) => cur || (seed && seed.partnerFranchiseId) || d.partners[0].franchiseId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [league.leagueId, deskKey, seed]);

  // Cache-first: paint the memory snapshot (seeded above) and only re-fan-out the heavy desk read when
  // it's gone stale — reopening a league's desk no longer fires a full refetch every single time. Cold
  // start seeds the disk copy first (partner + fit panel included), so a blank spinner shows only when
  // nothing is cached. Any trade write marks the desk stale, so a proposal/response still refreshes it.
  useEffect(() => {
    const hit = peekResource(deskKey);
    if (hit) { if (Date.now() - hit.at > STALE.DEFAULT) load(); return undefined; }
    let alive = true;
    getValue(deskKey).then((cached) => {
      if (alive && cached != null) {
        setData(cached);
        primeResource(deskKey, cached, 0);
        setLoading(false);
        if (cached.partners && cached.partners.length) setPartnerId((cur) => cur || (seed && seed.partnerFranchiseId) || cached.partners[0].franchiseId);
      }
      if (alive) load();
    });
    return () => { alive = false; };
  }, [deskKey, load, seed]);

  // As soon as desk data is available (cached or freshly loaded), make sure a partner is selected —
  // defensive complement to the lazy init + load()'s default, so the fit panel + "you get" list never
  // sit on "Pick a team above" while data is present.
  useEffect(() => {
    if (data && data.partners && data.partners.length) {
      setPartnerId((cur) => cur || (seed && seed.partnerFranchiseId) || data.partners[0].franchiseId);
    }
  }, [data, seed]);

  async function respond(offer, action, comments, drops) {
    // Accepting is a Pro action; rejecting/withdrawing stays free. (Inert until enforced.)
    if (action === 'accept' && !requirePro('trades.propose')) return;
    setBusy(offer.id);
    try {
      const res = await api.respondTrade(league.leagueId, offer.id, action, comments, drops);
      celebrate(action === 'accept' ? 'tradeAccepted' : action === 'revoke' ? 'offerWithdrawn' : 'offerRejected');
      // Reflect immediately: drop the card NOW (MFL's pendingTrades read lags a few seconds and is
      // cached ~12s, so a reload can still return the offer). Revalidate in the BACKGROUND — never
      // await it, so a slow/stalled reload can't strand the spinner or leave the responded card up.
      setDismissed((s) => new Set(s).add(offer.id));
      // The trade committed, but the follow-up DROP to fit the roster failed (MFL's accept can't carry
      // drops — it's a second write). Nothing is lost; the roster is just over-limit until the user drops
      // one, so say so plainly rather than silently leaving it illegal. (Non-destructive: C4.)
      if (res && res.dropError) {
        appAlert('Trade accepted — roster over limit', `The deal went through, but the drop to make room didn’t: ${res.dropError}\n\nDrop a player before your next lineup lock so your roster is legal.`);
      }
      load();
    } catch (e) {
      // A reject/accept can fail because the offer went STALE on MFL (a player/pick in it was already
      // traded or used) — MFL won't action it, so it'd otherwise sit in the inbox until it times out.
      // Offer to dismiss it locally instead of leaving the user stuck. (Revoke failures just report.)
      if (action !== 'revoke') {
        appAlert('Couldn’t action this trade', `${e.message}\n\nIt may no longer be valid on MyFantasyLeague. Remove it from your inbox?`, [
          { text: 'Keep', style: 'cancel' },
          { text: 'Dismiss', onPress: () => dismiss(offer) },
        ]);
      } else {
        appAlert('Could not respond', e.message);
      }
    } finally {
      setBusy(null);
    }
  }

  // Locally dismiss a dead incoming offer (MFL keeps it until timeout; this hides it from the inbox now).
  async function dismiss(offer) {
    setBusy(offer.id);
    setDismissed((s) => new Set(s).add(offer.id)); // reflect immediately
    try {
      await api.dismissTrade(league.leagueId, offer.id);
      load();
    } catch (e) {
      setDismissed((s) => { const n = new Set(s); n.delete(offer.id); return n; });
      appAlert('Could not dismiss', e.message);
    } finally {
      setBusy(null);
    }
  }

  // Reject opens a small modal so you can (optionally) attach a note MFL sends to the originator.
  function openReject(offer) { setRejectNote(''); setRejectTarget(offer); }
  async function confirmReject() {
    const offer = rejectTarget;
    const note = rejectNote.trim();
    setRejectTarget(null);
    if (offer) await respond(offer, 'reject', note || undefined);
  }

  // Withdraw (revoke) pulls back your own outgoing offer — a plain confirm; MFL takes no note here.
  function withdraw(offer) {
    appAlert('Withdraw offer?', `Pull back your offer to ${offer.withName || 'this team'}.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => respond(offer, 'revoke') },
    ]);
  }

  // Accept COMMITS the trade on MFL and can't be undone from the app — so, like withdraw/reject,
  // it double-confirms and echoes the deal (partner + market net) so you re-read what you're agreeing
  // to before it's final. Previously this fired on a single tap.
  function accept(offer) {
    const net = offer.analysis && typeof offer.analysis.net === 'number' ? offer.analysis.net : null;
    const netStr = net != null ? ` · market net ${net > 0 ? '+' : ''}${net}` : '';
    // Would accepting overflow the active roster? Only PLAYERS take a roster spot (picks/FAAB don't), so
    // the net change is (players in − players out). If the projected count tops the league's roster
    // limit, MFL's accept can't carry the drops — collect them first, then DROP right after the accept.
    const acquired = (offer.acquire || []).filter((a) => a.kind === 'player').length;
    const sent = (offer.send || []).filter((a) => a.kind === 'player').length;
    const size = data && typeof data.rosterSize === 'number' ? data.rosterSize : null;
    const count = data && typeof data.rosterCount === 'number' ? data.rosterCount : null;
    const need = size != null && count != null ? Math.max(0, count + acquired - sent - size) : 0;
    if (need > 0) { setDropTarget({ offer, need }); return; }
    appAlert(
      'Accept this trade?',
      `Complete the deal with ${offer.withName || 'this team'}${netStr}. This is final on MyFantasyLeague — it can’t be undone from the app.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Accept', onPress: () => respond(offer, 'accept') },
      ]
    );
  }

  const partner = useMemo(() => (data && data.partners || []).find((p) => p.franchiseId === partnerId) || null, [data, partnerId]);
  const receiveOptions = useMemo(() => sortAssets(partner ? partner.players : [], sortKey), [partner, sortKey]);
  const sendOptions = useMemo(() => sortAssets([...((data && data.myPlayers) || []), ...((data && data.myPicks) || [])], sortKey), [data, sortKey]);
  const sendList = Object.values(send);
  const receiveList = Object.values(receive);
  // Split offers by direction so Inbox (offers TO me) and Sent (offers FROM me) live on separate
  // tabs — a mixed list makes it easy to mistake a sent offer for one you can accept.
  const allOffers = ((data && data.offers) || []).filter((o) => !dismissed.has(o.id));
  const incomingOffers = allOffers.filter((o) => o.direction !== 'outgoing');
  const outgoingOffers = allOffers.filter((o) => o.direction === 'outgoing');
  const activeOffers = tab === 'sent' ? outgoingOffers : incomingOffers;
  const completedTrades = (data && data.completedTrades) || [];
  const preview = useMemo(() => tradeMath.analyze(receiveList, sendList), [receiveList, sendList]);
  const personalPreview = useMemo(() => tradeMath.personalAnalyze(receiveList, sendList), [receiveList, sendList]);
  // Win-now (this-season) read of the same deal. Shown only when it DIVERGES from the dynasty
  // verdict — that's the signal a contender needs (a dynasty-favorable "sell the vet" that actually
  // hurts your window). When your team's outlook is win-now, this lens is the one that leads.
  const myOutlook = data && data.me ? data.me.outlook : null;
  const winNowLine = useMemo(() => {
    if (!preview.winNow || preview.winNow.verdict === preview.verdict) return null;
    return { ...preview.winNow, isLead: myOutlook === 'win-now' };
  }, [preview, myOutlook]);
  // Live construction for BOTH sides of the offer being built.
  const buildFit = useMemo(() => {
    if (!partner || !sendList.length || !receiveList.length) return null;
    return {
      me: constructionOf(sendList, receiveList, data && data.me && data.me.needs, data && data.me && data.me.surplus, 'you', data && data.me && data.me.depth),
      them: constructionOf(receiveList, sendList, partner.needs, partner.surplus, 'they', partner.depth),
    };
  }, [partner, sendList, receiveList, data]);
  // One reconciled "is this a good idea?" line for the deal being BUILT — the same value×construction
  // synthesis the sent-offer card already shows, computed from the shared trade-math so the builder and
  // the card can't disagree. Answers the question at the moment you commit (usability backlog #17):
  // needs both sides filled, leads on the lens your window cares about (win-now for a contender).
  const buildBottomLine = useMemo(() => {
    if (!sendList.length || !receiveList.length) return null;
    const lead = tradeMath.leadingLens(preview, myOutlook);
    const rating = buildFit && buildFit.me ? buildFit.me.rating : 'neutral';
    return tradeMath.bottomLine(lead.verdict, rating);
  }, [sendList.length, receiveList.length, preview, myOutlook, buildFit]);
  const tendencyNote = partnerTendency(partner);

  function toggle(setFn, obj, asset) {
    setFn((cur) => {
      const next = { ...cur };
      if (next[asset.id]) delete next[asset.id];
      else next[asset.id] = asset;
      return next;
    });
  }
  // FAAB (blind-bidding budget) as a tradeable asset: one synthetic BB_<amount> entry per side,
  // driven by a stepper (not the checkbox list). Its value uses the same per-dollar weight as
  // the backend so the live preview matches the analyzed offer. Editing replaces the entry.
  const faabOf = (map) => { const f = Object.values(map).find((a) => a.kind === 'faab'); return f ? f.amount : 0; };
  const setFaab = (setFn, amount) => setFn((cur) => {
    const next = {};
    for (const [k, a] of Object.entries(cur)) if (a.kind !== 'faab') next[k] = a;
    if (amount > 0) {
      const tok = `BB_${amount}`;
      next[tok] = { id: tok, kind: 'faab', name: `$${amount} FAAB`, position: 'FAAB', amount, value: Math.round(amount * 0.2) };
    }
    return next;
  });
  // Reset the "you get" side when switching partners (and drop any counter context).
  function pickPartner(id) {
    setPartnerId(id);
    setReceive({});
    setCounterInfo(null);
    setDealNote(null);
  }

  // "Send another offer" from a sent offer: jump to the Propose builder pre-aimed at the SAME owner,
  // with both sides cleared for a fresh alternative. Managers routinely fire several options at one
  // team; this makes the next one a single tap instead of re-selecting the partner on the Propose tab.
  function startAnother(offer) {
    if (!offer || !offer.withFranchiseId) return;
    pickPartner(offer.withFranchiseId); // sets partner + clears the "you get" side and counter/deal note
    setSend({}); // also clear the "you give" side — this is a brand-new offer, not a tweak of the last
    setTab('propose');
    toast(`Building another offer to ${offer.withName}`);
  }

  // Ask the backend for a fair, needs-fitting package to acquire `targetId` and load it
  // into the "you send" side. Target defaults to the most valuable player you're getting.
  const applySuggestion = useCallback(async (targetId, pId) => {
    const pf = pId || partnerId;
    const tid = targetId || (Object.values(receive).sort((a, b) => (b.value || 0) - (a.value || 0))[0] || {}).id;
    if (!pf || !tid) return;
    setSuggesting(true);
    try {
      const s = await api.suggestTrade(league.leagueId, tid, pf);
      const map = {};
      for (const g of s.give || []) map[g.id] = g;
      setSend(map);
    } catch (e) {
      // Keep whatever's on the "you send" side, but tell the user it didn't work — a spinner that stops
      // with no change and no message reads as "the feature is broken". (matches applyAsk/applyFullDeal.)
      toast('Couldn’t build a suggestion — try again');
    } finally {
      setSuggesting(false);
    }
  }, [league.leagueId, partnerId, receive]);

  // The counter-ASK: given what you've picked to SEND, ask the backend for a fair return from the
  // partner (their trade bait + your needs) and load it into the "you get" side.
  const applyAsk = useCallback(async () => {
    const ids = Object.values(send).map((a) => a.id);
    if (!partnerId || !ids.length) return;
    setSuggesting(true);
    try {
      const a = await api.askTrade(league.leagueId, ids, partnerId);
      setReceive(Object.fromEntries((a.ask || []).map((x) => [x.id, x])));
    } catch (e) {
      appAlert('Could not suggest an ask', e.message);
    } finally {
      setSuggesting(false);
    }
  }, [league.leagueId, partnerId, send]);

  // Build a full deal from zero with the current partner — fills BOTH sides of the builder.
  const applyFullDeal = useCallback(async () => {
    if (!partnerId) return;
    setSuggesting(true);
    try {
      const d = await api.fullDeal(league.leagueId, partnerId);
      setSend(Object.fromEntries((d.send || []).map((a) => [a.id, a])));
      setReceive(Object.fromEntries((d.receive || []).map((a) => [a.id, a])));
      setCounterInfo(null);
      setDealNote({ rationale: d.rationale, verdict: d.verdict });
    } catch (e) {
      appAlert('Could not build a deal', e.message);
    } finally {
      setSuggesting(false);
    }
  }, [league.leagueId, partnerId]);

  // Build a value-balanced counter to an incoming offer and load it into the builder
  // (both sides prefilled, partner = the offering team). Keeps their construction.
  const startCounter = useCallback(async (offer) => {
    setSuggesting(true);
    try {
      const c = await api.counterTrade(league.leagueId, offer.id);
      setPartnerId(c.toFranchiseId);
      setReceive(Object.fromEntries((c.receive || []).map((a) => [a.id, a])));
      setSend(Object.fromEntries((c.give || []).map((a) => [a.id, a])));
      setCounterInfo({ offerId: c.counterOfferId, rationale: c.rationale });
      setTab('propose');
    } catch (e) {
      appAlert('Could not build a counter', e.message);
    } finally {
      setSuggesting(false);
    }
  }, [league.leagueId]);

  // Seeded entry: either "trade for <player>" (preselect target + suggest a package) or
  // "counter <offer>" (from the cross-league hub). Runs once when the desk data lands.
  useEffect(() => {
    if (!seed || !data || seededRef.current) return;
    seededRef.current = true;
    if (seed.counterOfferId) {
      startCounter({ id: seed.counterOfferId });
      return;
    }
    // Pre-seeded suggested deal from Pick Capital's shop/acquire flow: BOTH sides prefilled. sendTokens
    // resolve against my players+picks, receiveTokens against the chosen partner's assets — so the desk
    // opens on the exact deal the shortlist proposed, ready to tweak or send.
    if (seed.sendTokens && seed.sendTokens.length) {
      const mineAll = [...(data.myPlayers || []), ...(data.myPicks || [])];
      const wantSend = new Set(seed.sendTokens.map(String));
      const pickedSend = mineAll.filter((a) => wantSend.has(String(a.id)));
      if (pickedSend.length) setSend(Object.fromEntries(pickedSend.map((a) => [a.id, a])));
      const partnerD = (data.partners || []).find((p) => p.franchiseId === seed.partnerFranchiseId);
      if (seed.receiveTokens && seed.receiveTokens.length && partnerD) {
        const wantRecv = new Set(seed.receiveTokens.map(String));
        const pickedRecv = (partnerD.players || []).filter((a) => wantRecv.has(String(a.id)));
        if (pickedRecv.length) setReceive(Object.fromEntries(pickedRecv.map((a) => [a.id, a])));
      }
      return;
    }
    // "Shop <my player>" from On the Block: pre-load him on the SEND side and select the
    // suggested partner (defaulted in load()). The user then picks what to ask for.
    if (seed.sendPlayerId) {
      const mine = (data.myPlayers || []).find((pl) => String(pl.id) === String(seed.sendPlayerId));
      if (mine) setSend({ [mine.id]: mine });
      return;
    }
    // "Trade this pick" from the roster: pre-load the pick on the SEND side.
    if (seed.sendPickToken) {
      const pick = (data.myPicks || []).find((pk) => String(pk.id) === String(seed.sendPickToken));
      if (pick) setSend({ [pick.id]: pick });
      return;
    }
    const partner = (data.partners || []).find((p) => p.franchiseId === seed.partnerFranchiseId);
    // "Propose trade for these" from a rival's block: pre-check the chosen assets on the YOU-GET side.
    if (seed.receiveTokens && seed.receiveTokens.length && partner) {
      const want = new Set(seed.receiveTokens.map(String));
      const picked = (partner.players || []).filter((pl) => want.has(String(pl.id)));
      if (picked.length) setReceive(Object.fromEntries(picked.map((pl) => [pl.id, pl])));
      return;
    }
    const target = partner && partner.players.find((pl) => String(pl.id) === String(seed.targetPlayerId));
    if (target) setReceive({ [target.id]: target });
    applySuggestion(seed.targetPlayerId, seed.partnerFranchiseId);
  }, [data, seed, applySuggestion, startCounter]);

  async function submitProposal() {
    if (!requirePro('trades.propose')) return; // Pro gate (inert until enforced)
    setSending(true);
    try {
      const res = await api.proposeTrade(league.leagueId, {
        toFranchiseId: partnerId,
        give: sendList.map((a) => a.id),
        receive: receiveList.map((a) => a.id),
      });
      celebrate('offerSent');
      // Countering means declining their exact terms: once ours is sent, reject theirs.
      if (counterInfo) {
        try { await api.respondTrade(league.leagueId, counterInfo.offerId, 'reject'); } catch (e) { /* leave it */ }
      }
      // In the multi-league wizard: give quiet feedback and hand the "what next" choice to the
      // wizard's own inline bar. Do NOT show an alert here — the desk's alert + the wizard's alert
      // used to stack into two chained dialogs. Clear the builder so a dismissed bar leaves it clean.
      if (onSent) {
        toast(`Offer sent to ${res.offer.withName}`);
        setSend({});
        setReceive({});
        setCounterInfo(null);
        onSent();
        return;
      }
      toast(`${counterInfo ? 'Counter sent' : 'Trade proposed'} · sent to ${res.offer.withName}${counterInfo ? ' (their offer declined)' : ''}`);
      setSend({});
      setReceive({});
      setCounterInfo(null);
      setTab('sent'); // land on Sent so the just-proposed offer is right there to review/withdraw
      await load();
    } catch (e) {
      appAlert('Could not propose', e.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        <View style={styles.topbar}>
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <TopbarTitle numberOfLines={1}>{league.name}</TopbarTitle>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.error}>{error || 'Could not load trades.'}</Text>
          <Pressable style={styles.retry} onPress={load}><Text style={styles.retryText}>Retry</Text></Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <TopbarTitle numberOfLines={1}>{league.name}</TopbarTitle>
        <View style={{ width: 44 }} />
      </View>
      {data && data.format ? (
        <Text style={styles.formatNote} numberOfLines={1}>{data.format} · values are league-specific</Text>
      ) : null}

      <View style={styles.segment}>
        {[
          ['inbox', `Inbox${incomingOffers.length ? ` · ${incomingOffers.length}` : ''}`],
          ['sent', `Sent${outgoingOffers.length ? ` · ${outgoingOffers.length}` : ''}`],
          ['propose', 'Propose'],
        ].map(([k, label]) => (
          <Pressable key={k} style={[styles.seg, tab === k && styles.segActive]} onPress={() => setTab(k)}>
            <Text style={[styles.segText, tab === k && styles.segTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Manual trade deadline — MFL exposes none, so the owner sets it; it then counts down on
          On Deck. */}
      <View style={styles.deadlineRow}>
        <Text style={[styles.deadlineLabel, displayLabel()]}>Trade deadline</Text>
        {editingDeadline ? (
          <View style={styles.deadlineEdit}>
            <TextInput
              style={styles.deadlineInput}
              value={deadlineInput}
              onChangeText={setDeadlineInput}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <Pressable
              onPress={() => /^\d{4}-\d{2}-\d{2}$/.test(deadlineInput.trim()) ? saveDeadline(deadlineInput.trim()) : appAlert('Enter a date', 'Use the format YYYY-MM-DD (e.g. 2026-11-15).')}
              disabled={savingDeadline}
              style={styles.deadlineSave}
            >
              {savingDeadline ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.deadlineSaveTxt}>Save</Text>}
            </Pressable>
            <Pressable onPress={() => setEditingDeadline(false)} hitSlop={8}><GlyphMark name="x" size={14} color={colors.textDim} weight={2} /></Pressable>
          </View>
        ) : deadline ? (
          <View style={styles.deadlineEdit}>
            <Text style={styles.deadlineVal}>{deadline}</Text>
            {deadlineIsAuto ? <Text style={styles.deadlineSrc}>· from your league</Text> : null}
            <Pressable onPress={() => { setDeadlineInput(deadlineIsAuto ? '' : deadline); setEditingDeadline(true); }} hitSlop={8}>
              <Text style={styles.deadlineEditBtn}>{deadlineIsAuto ? 'Override' : 'Edit'}</Text>
            </Pressable>
            {deadlineIsAuto ? null : <Pressable onPress={() => saveDeadline(null)} hitSlop={8}><Text style={styles.deadlineClear}>Clear</Text></Pressable>}
          </View>
        ) : (
          <Pressable onPress={() => { setDeadlineInput(''); setEditingDeadline(true); }} hitSlop={8}>
            <Text style={styles.deadlineSet}>＋ Set</Text>
          </Pressable>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {tab === 'inbox' || tab === 'sent' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {activeOffers.length === 0 ? (
            <Text style={styles.empty}>
              {tab === 'sent'
                ? 'No open offers you’ve sent in this league. Build one on the Propose tab.'
                : 'No incoming trade offers in this league.'}
            </Text>
          ) : (
            activeOffers.map((o, i) => (
              <Reveal key={o.id} delay={Math.min(i, 6) * 55}>
                <OfferCard offer={o} busy={busy === o.id} onAccept={accept} onReject={openReject} onDismiss={dismiss} onWithdraw={withdraw} onCounter={startCounter} onSendAnother={startAnother} onOpenPlayer={onOpenPlayer} onReviewRoster={onOpenRoster ? () => onOpenRoster(league) : null} />
              </Reveal>
            ))
          )}

          {/* Sent tab only: a toggle to reveal my completed (accepted) trades from league history. */}
          {tab === 'sent' && completedTrades.length ? (
            <>
              <Pressable onPress={() => setShowCompleted((v) => !v)} style={({ pressed }) => [styles.completedToggle, pressed && { opacity: 0.7 }]}>
                <Text style={styles.completedToggleText}>{showCompleted ? '▾ ' : '▸ '}Completed trades · {completedTrades.length}</Text>
              </Pressable>
              {showCompleted
                ? completedTrades.map((ct) => <CompletedTradeCard key={ct.id} trade={ct} onOpenPlayer={onOpenPlayer} />)
                : null}
            </>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: footerH + 24 }]}>
          {counterInfo ? (
            <View style={styles.counterBanner}>
              <View style={styles.counterTitleRow}>
                <NeonSign glyph="undo" color="accent" grade="inline" size={13} />
                <Text style={styles.counterTitle}>Countering their offer</Text>
              </View>
              <Text style={styles.counterText}>{counterInfo.rationale}</Text>
            </View>
          ) : dealNote ? (
            <View style={styles.counterBanner}>
              <Text style={styles.counterTitle}>✦ Suggested deal · {dealNote.verdict}</Text>
              <Text style={styles.counterText}>{dealNote.rationale}</Text>
            </View>
          ) : null}
          <Text style={styles.label}>Trade with</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.partnerRow}>
            {(data.partners || []).map((p) => (
              <Pressable key={p.franchiseId} style={[styles.partnerChip, partnerId === p.franchiseId && styles.partnerChipActive]} onPress={() => pickPartner(p.franchiseId)}>
                <Text style={[styles.partnerText, partnerId === p.franchiseId && { color: colors.text }]} numberOfLines={1}>{p.name}</Text>
                {p.baitCount > 0 ? <Text style={styles.chipBait} numberOfLines={1}>⇄ {p.baitCount} on the block</Text> : null}
              </Pressable>
            ))}
          </ScrollView>

          {partner ? (
            <View style={styles.fitPanel}>
              <View style={styles.fitCol}>
                <Text style={styles.fitTeam} numberOfLines={1}>You</Text>
                {data.me && (data.me.outlook || data.me.avgAge != null) ? (
                  <Text style={styles.fitMeta} numberOfLines={1}>{[shortOutlook(data.me.outlook), data.me.avgAge != null ? `${data.me.avgAge} yr` : null].filter(Boolean).join(' · ')}</Text>
                ) : null}
                <Text style={styles.fitLine}><Text style={styles.fitNeed}>NEED </Text>{posList(data.me && data.me.needs)}</Text>
                <Text style={styles.fitLine}><Text style={styles.fitSurp}>SURPLUS </Text>{posList(data.me && data.me.surplus)}</Text>
              </View>
              <View style={styles.fitDiv} />
              <View style={styles.fitCol}>
                <Text style={styles.fitTeam} numberOfLines={1}>{partner.name}</Text>
                {partner.outlook || partner.avgAge != null ? (
                  <Text style={styles.fitMeta} numberOfLines={1}>{[shortOutlook(partner.outlook), partner.avgAge != null ? `${partner.avgAge} yr` : null].filter(Boolean).join(' · ')}</Text>
                ) : null}
                <Text style={styles.fitLine}><Text style={styles.fitNeed}>NEED </Text>{posList(partner.needs)}</Text>
                <Text style={styles.fitLine}><Text style={styles.fitSurp}>SURPLUS </Text>{posList(partner.surplus)}</Text>
              </View>
            </View>
          ) : null}

          {partner ? (
            <View style={styles.sortRow}>
              <Text style={styles.sortLabel}>SORT</Text>
              {SORTS.map(([k, l]) => (
                <Pressable key={k} onPress={() => setSortKey(k)} style={[styles.sortChip, sortKey === k && styles.sortChipOn]} hitSlop={6}>
                  <Text style={[styles.sortChipTxt, sortKey === k && styles.sortChipTxtOn]}>{l}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {partner ? (
            <>
              {/* One-tap full deal from zero: fills BOTH sides at once (their surplus/bait at your
                  need ⇄ your bait at their need). */}
              <Pressable
                onPress={() => applyFullDeal()}
                disabled={suggesting}
                style={({ pressed }) => [styles.dealBtn, suggesting && styles.suggestOff, pressed && { opacity: 0.85 }]}
              >
                {suggesting ? <ActivityIndicator size="small" color={colors.accent} /> : (
                  <Text style={styles.dealBtnTxt}>✦ Suggest a full deal</Text>
                )}
              </Pressable>

              {/* Two-way suggester: pick what you WANT → suggest what to send; or pick what you'll
                  SEND → suggest a fair ask from their side (their trade bait + your needs). */}
              <View style={styles.suggestRow}>
                <Pressable
                  onPress={() => applySuggestion()}
                  disabled={!receiveList.length || suggesting}
                  style={({ pressed }) => [styles.suggestHalf, (!receiveList.length || suggesting) && styles.suggestOff, pressed && { opacity: 0.85 }]}
                >
                  {suggesting ? <ActivityIndicator size="small" color={colors.accent} /> : (
                    <Text style={styles.suggestTxt} numberOfLines={2}>✦ {receiveList.length ? 'Suggest what to send' : 'Pick what you want →'}</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => applyAsk()}
                  disabled={!sendList.length || suggesting}
                  style={({ pressed }) => [styles.suggestHalf, (!sendList.length || suggesting) && styles.suggestOff, pressed && { opacity: 0.85 }]}
                >
                  {suggesting ? <ActivityIndicator size="small" color={colors.accent} /> : (
                    <Text style={[styles.suggestTxt, { color: colors.accent }]} numberOfLines={2}>✦ {sendList.length ? 'Suggest what to ask for' : 'Pick what you send →'}</Text>
                  )}
                </Pressable>
              </View>

              {/* The builder itself, side by side: check YOUR players/picks on the left to send,
                  and THEIR players/picks on the right to get. */}
              <View style={styles.buildCols}>
                <View style={styles.buildCol}>
                  <Text style={[styles.buildColLabel, displayLabel()]} numberOfLines={1}>YOU SEND{sendList.length ? ` · ${preview.sendValue}` : ''}</Text>
                  {sendOptions.map((a) => (
                    <AssetRow key={a.id} asset={a} on={!!send[a.id]} onPress={() => toggle(setSend, send, a)} tint={colors.accent} compact />
                  ))}
                  {/* FAAB is tradeable in most leagues — add blind-bid budget to your side. */}
                  <FaabInput amount={faabOf(send)} onChange={(n) => setFaab(setSend, n)} tint={colors.accent} />
                </View>
                <View style={styles.buildColDiv} />
                <View style={styles.buildCol}>
                  <Text style={[styles.buildColLabel, displayLabel()]} numberOfLines={1}>YOU GET{receiveList.length ? ` · ${preview.acquireValue}` : ''}</Text>
                  {receiveOptions.map((a) => (
                    <AssetRow key={a.id} asset={a} on={!!receive[a.id]} onPress={() => toggle(setReceive, receive, a)} tint={colors.accent} compact />
                  ))}
                  <FaabInput amount={faabOf(receive)} onChange={(n) => setFaab(setReceive, n)} tint={colors.accent} />
                </View>
              </View>
              <ValueCredit center style={styles.credit} />
            </>
          ) : <Text style={styles.empty}>Pick a team above.</Text>}
        </ScrollView>
      )}

      {tab === 'propose' ? (
        <View style={styles.footer} onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}>
          {buildFit ? (
            <View style={styles.buildFit}>
              <Text style={[styles.buildFitLine, { color: (CONSTRUCTION[buildFit.me.rating] || CONSTRUCTION.neutral).color }]} numberOfLines={1}>
                {(CONSTRUCTION[buildFit.me.rating] || CONSTRUCTION.neutral).icon} You — {buildFit.me.reason}
              </Text>
              <Text style={[styles.buildFitLine, { color: (CONSTRUCTION[buildFit.them.rating] || CONSTRUCTION.neutral).color }]} numberOfLines={1}>
                {(CONSTRUCTION[buildFit.them.rating] || CONSTRUCTION.neutral).icon} {partner ? partner.name : 'Them'} — {buildFit.them.reason}
              </Text>
            </View>
          ) : null}
          {receiveList.length || sendList.length ? (
            <TradeColumns
              give={sendList}
              get={receiveList}
              giveTotal={preview.sendValue}
              getTotal={preview.acquireValue}
              giveLabel="You send"
              getLabel="You get"
              onOpenPlayer={onOpenPlayer}
            />
          ) : null}
          {tendencyNote ? <Text style={styles.tendencyNote} numberOfLines={2}>ℹ {tendencyNote}</Text> : null}
          <View style={styles.previewRow}>
            <Text style={styles.previewText}>
              You get <Text style={styles.previewStrong}>{preview.acquireValue}</Text> · send <Text style={styles.previewStrong}>{preview.sendValue}</Text>
            </Text>
            <Text style={[styles.previewVerdict, { color: VERDICT[preview.verdict].color }]}>{VERDICT[preview.verdict].label}</Text>
          </View>
          {winNowLine ? (
            <Text style={[styles.personalLine, { textAlign: 'right', color: VERDICT[winNowLine.verdict].color }]}>
              {winNowLine.isLead ? 'Win-now · your window ⚑' : 'Win-now'} · net {winNowLine.net > 0 ? '+' : ''}{winNowLine.net} · {VERDICT[winNowLine.verdict].label}
            </Text>
          ) : null}
          {personalPreview ? (
            <Text style={[styles.personalLine, { textAlign: 'right', color: VERDICT[personalPreview.verdict].color }]}>
              For you · net {personalPreview.net > 0 ? '+' : ''}{personalPreview.net} · {VERDICT[personalPreview.verdict].label}
            </Text>
          ) : null}
          {buildBottomLine ? (
            <View style={[styles.bottomLine, { borderLeftColor: TONE[buildBottomLine.tone] || colors.textDim }]}>
              <Text style={[styles.bottomLineText, { color: TONE[buildBottomLine.tone] || colors.text }]}>{buildBottomLine.text}</Text>
            </View>
          ) : null}
          <Button
            title={counterInfo ? 'Send Counter' : 'Propose Trade'}
            onPress={submitProposal}
            busy={sending}
            disabled={!sendList.length || !receiveList.length}
          />
        </View>
      ) : null}

      {/* Reject an incoming offer, optionally with a note MFL delivers to the originator. */}
      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <Pressable style={styles.modalScrim} onPress={() => setRejectTarget(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <Pressable style={styles.rejectSheet} onPress={() => {}}>
            <Text style={styles.rejectTitle}>Reject offer{rejectTarget && rejectTarget.withName ? ` from ${rejectTarget.withName}` : ''}?</Text>
            <Text style={styles.rejectHint}>Add an optional note for them (they’ll see it with the rejection).</Text>
            <TextInput
              style={styles.rejectInput}
              value={rejectNote}
              onChangeText={setRejectNote}
              placeholder="Optional message…"
              placeholderTextColor={colors.textDim}
              multiline
              maxLength={200}
            />
            <View style={styles.rejectActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setRejectTarget(null)} style={{ flex: 1 }} />
              <Button title={rejectNote.trim() ? 'Reject + send note' : 'Reject'} variant="ghost" onPress={confirmReject} style={{ flex: 1 }} />
            </View>
          </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* Accept-with-drops: an incoming offer that would push your active roster over its limit. Pick the
          players to drop so it fits; we accept, then DROP them right after (MFL's accept can't carry them). */}
      <DropSheet
        target={dropTarget}
        myPlayers={data.myPlayers}
        busy={!!dropTarget && busy === dropTarget.offer.id}
        onCancel={() => setDropTarget(null)}
        onConfirm={(ids) => { const t = dropTarget; setDropTarget(null); if (t) respond(t.offer, 'accept', undefined, ids); }}
      />
    </View>
  );
}

// Pick the players to drop so an incoming trade fits under the roster limit. Candidates are your active
// players minus any you're already sending in the deal; you must choose at least `need`. On confirm the
// caller accepts the trade with these as the follow-up drops. Value-sorted ascending is NOT applied —
// myPlayers arrives value-DESC from the desk, so your keepers sit up top and the cuttable depth at the
// bottom; the whole list is scrollable either way.
function DropSheet({ target, myPlayers, busy, onCancel, onConfirm }) {
  const [sel, setSel] = useState({});
  const offer = target && target.offer;
  const offerId = offer && offer.id;
  const need = target ? target.need : 0;
  // Reset the selection whenever the sheet opens on a different offer.
  useEffect(() => { setSel({}); }, [offerId]);
  useAndroidBack(useCallback(() => { if (target) { onCancel(); return true; } return false; }, [target, onCancel]));
  if (!target) return null;
  const sendIds = new Set((offer.send || []).map((a) => String(a.id)));
  const candidates = (myPlayers || []).filter((p) => !sendIds.has(String(p.id)));
  const chosen = Object.keys(sel).filter((k) => sel[k]);
  const enough = chosen.length >= need;
  const incoming = (offer.acquire || []).filter((a) => a.kind === 'player').length;
  const outgoing = (offer.send || []).filter((a) => a.kind === 'player').length;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.modalScrim}>
        <View style={styles.dropSheet}>
          <Text style={styles.dropTitle}>Make room to accept</Text>
          <Text style={styles.dropHint}>
            This deal brings in {incoming} player{incoming === 1 ? '' : 's'} for {outgoing} — your roster would be over the limit. Pick {need === 1 ? 'a player' : `${need} players`} to drop so it fits; they’re dropped right after the trade completes.
          </Text>
          <Text style={styles.dropCount}>
            <Text style={{ color: enough ? colors.good : colors.warn }}>{chosen.length}</Text> / {need} selected
          </Text>
          <ScrollView style={styles.dropList} contentContainerStyle={{ paddingBottom: 8 }}>
            {candidates.map((p) => {
              const on = !!sel[p.id];
              return (
                <Pressable key={p.id} style={({ pressed }) => [styles.dropRow, on && styles.dropRowOn, pressed && { opacity: 0.8 }]} onPress={() => setSel((c) => ({ ...c, [p.id]: !c[p.id] }))}>
                  <View style={[styles.check, on && { backgroundColor: colors.bad, borderColor: colors.bad }]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                  <View style={[styles.dot, { backgroundColor: positionColors[p.position] || colors.textDim }]} />
                  <Text style={styles.dropName} numberOfLines={1}>{p.name}</Text>
                  {p.bait ? <Text style={styles.baitTag}>⇄</Text> : null}
                  <Text style={styles.dropMeta} numberOfLines={1}>{[p.position, p.team].filter(Boolean).join(' · ')}{p.value != null ? ` · ${p.value}` : ''}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.dropActions}>
            <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
            <Button title={chosen.length ? `Drop ${chosen.length} & accept` : 'Accept'} onPress={() => onConfirm(chosen)} busy={busy} disabled={!enough} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// One lens of the value read: a dim label + a signed, verdict-colored net. Several sit in a row so
// the market baseline and the win-now / "for you" lenses scan as one cluster, not stacked headlines.
function NetChip({ label, net, color }) {
  return (
    <View style={styles.netChip} accessibilityRole="text" accessibilityLabel={`${label} net ${net > 0 ? 'plus ' : ''}${net}`}>
      <Text style={styles.netChipLabel}>{label}</Text>
      <Text style={[styles.netChipVal, { color }]}>{net > 0 ? '+' : ''}{net}</Text>
    </View>
  );
}

function OfferCard({ offer, busy, onAccept, onReject, onDismiss, onWithdraw, onCounter, onSendAnother, onOpenPlayer, onReviewRoster }) {
  const v = VERDICT[offer.analysis.verdict] || VERDICT.fair;
  const outgoing = offer.direction === 'outgoing';
  // A colored left stripe + a direction pill so received-vs-sent reads instantly, even at a glance.
  // Direction isn't VALUE, so it doesn't get gold (color law) — warn = you SENT it, blue = it came TO you.
  const dirColor = outgoing ? colors.warn : colors.accent;
  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: dirColor }]}>
      <View style={styles.cardTop}>
        <View style={[styles.dirPill, { borderColor: dirColor }]}>
          <Text style={[styles.dirPillText, { color: dirColor }]}>{outgoing ? 'SENT' : 'RECEIVED'}</Text>
        </View>
        <Text style={styles.cardFrom} numberOfLines={1}>
          <Text style={styles.cardDir}>{outgoing ? 'to ' : 'from '}</Text>
          {offer.withName}
        </Text>
        <View style={[styles.badge, { borderColor: v.color }]}>
          <Text style={[styles.badgeText, { color: v.color }]}>{v.label}</Text>
        </View>
      </View>
      <Side label="You get" assets={offer.acquire} total={offer.analysis.acquireValue} tint={colors.good} onOpenPlayer={onOpenPlayer} />
      <Side label="You give" assets={offer.send} total={offer.analysis.sendValue} tint={colors.textDim} onOpenPlayer={onOpenPlayer} />
      {/* Value read — one compact strip instead of three stacked "net" headlines. Market is the
          baseline; the win-now and "for you" lenses appear only when they diverge, as clearly-
          secondary reads, so the eye isn't met by a wall of competing numbers before the call. */}
      <View style={styles.valueRow}>
        <NetChip label="Market" net={offer.analysis.net} color={v.color} />
        {offer.analysis.winNow && offer.analysis.winNow.verdict !== offer.analysis.verdict ? (
          <NetChip
            label={offer.analysis.lens === 'winNow' ? 'Win-now ⚑' : 'Win-now'}
            net={offer.analysis.winNow.net}
            color={(VERDICT[offer.analysis.winNow.verdict] || VERDICT.fair).color}
          />
        ) : null}
        {offer.personal ? (
          <NetChip label="For you" net={offer.personal.net} color={(VERDICT[offer.personal.verdict] || VERDICT.fair).color} />
        ) : null}
        <Text style={styles.valueEst}>est.</Text>
      </View>
      {offer.tagNotes && offer.tagNotes.length ? (
        <View style={styles.tagNotes}>
          {offer.tagNotes.map((n, i) => (
            <Text key={i} style={[styles.tagNote, { color: n.level === 'good' ? colors.good : colors.warn }]}>
              {n.level === 'good' ? '✓' : '⚠'} {n.text}
            </Text>
          ))}
        </View>
      ) : null}
      {offer.construction ? (
        // Both sides' roster-construction read — my side always, and the partner's when known, so
        // an INCOMING offer also shows whether it helps THEM (context on how motivated they are),
        // matching the two-sided read the live builder shows.
        <View style={[styles.construction, { borderColor: (CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).color }]}>
          <Text style={[styles.constructionText, { color: (CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).color }]}>
            {(CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).icon} You — {offer.construction.reason}
          </Text>
          {offer.partnerConstruction ? (
            <Text style={[styles.constructionText, { color: (CONSTRUCTION[offer.partnerConstruction.rating] || CONSTRUCTION.neutral).color, marginTop: 4 }]}>
              {(CONSTRUCTION[offer.partnerConstruction.rating] || CONSTRUCTION.neutral).icon} {offer.withName} — {offer.partnerConstruction.reason}
            </Text>
          ) : null}
        </View>
      ) : null}
      {offer.bottomLine ? (
        <View style={[styles.bottomLine, { borderLeftColor: TONE[offer.bottomLine.tone] || colors.textDim }]}>
          <Text style={[styles.bottomLineText, { color: TONE[offer.bottomLine.tone] || colors.text }]}>{offer.bottomLine.text}</Text>
        </View>
      ) : null}
      {offer.invalid && offer.id && onDismiss ? (
        // DEAD offer — a player/pick in it was already traded or used, so MFL won't let you accept OR
        // reject it (it just lingers until timeout). Say so plainly and offer a local Dismiss.
        <>
          <View style={styles.invalidBanner}>
            <Text style={styles.invalidText}>⚠ No longer valid{offer.invalidReason ? ` — ${offer.invalidReason}` : ''}. MyFantasyLeague won’t let this be accepted or rejected.</Text>
          </View>
          <Button title="Dismiss" variant="ghost" onPress={() => onDismiss(offer)} busy={busy} style={{ marginTop: space.sm }} />
        </>
      ) : offer.canRespond ? (
        // Incoming offer we're the target of → accept / reject (reject can carry a note), plus a
        // "Review roster" jump so you can see the rest of your team in context before deciding.
        <>
          {onReviewRoster ? (
            <Pressable style={({ pressed }) => [styles.reviewBtn, pressed && { opacity: 0.7 }]} onPress={onReviewRoster} disabled={busy}>
              <Text style={styles.reviewBtnText}>⌂ Review my roster in context</Text>
            </Pressable>
          ) : null}
          <View style={styles.cardActions}>
            <Button title="Reject" variant="ghost" onPress={() => onReject(offer)} disabled={busy} style={{ flex: 1 }} />
            <Button title="Accept" onPress={() => onAccept(offer)} busy={busy} style={{ flex: 1 }} />
          </View>
        </>
      ) : offer.canRevoke ? (
        // Our own outgoing offer → withdraw it (revoke), or fire ANOTHER option to the same owner.
        // Sending several alternatives to one manager at once is a normal trade tactic, so make that
        // one tap from a sent offer instead of hunting back to the Propose tab and re-picking the team.
        <>
          <View style={styles.cardActions}>
            <Button title="Withdraw offer" variant="ghost" onPress={() => onWithdraw(offer)} busy={busy} style={{ flex: 1 }} />
          </View>
          {onSendAnother ? (
            <Pressable style={({ pressed }) => [styles.counterBtn, pressed && { opacity: 0.7 }]} onPress={() => onSendAnother(offer)} disabled={busy}>
              <View style={styles.counterBtnRow}>
                <NeonSign glyph="swap" color="accent" grade="inline" size={13} />
                <Text style={styles.counterBtnText}>Send another offer</Text>
              </View>
            </Pressable>
          ) : null}
        </>
      ) : (
        // Can't be actioned via MFL AND not flagged invalid — still let an INCOMING offer be dismissed
        // so nothing is ever permanently stuck in the inbox.
        <>
          <Text style={styles.noRespond}>This offer can’t be actioned here — open it in MyFantasyLeague.</Text>
          {!outgoing && offer.id && onDismiss ? (
            <Button title="Dismiss from inbox" variant="ghost" onPress={() => onDismiss(offer)} disabled={busy} style={{ marginTop: space.sm }} />
          ) : null}
        </>
      )}
      {/* Counter is only for offers made TO you — you can't "counter" your own outgoing offer (that's
          just sending another), and a dead offer isn't worth countering. */}
      {onCounter && !outgoing && !offer.invalid ? (
        <Pressable style={({ pressed }) => [styles.counterBtn, pressed && { opacity: 0.7 }]} onPress={() => onCounter(offer)} disabled={busy}>
          <View style={styles.counterBtnRow}>
            <NeonSign glyph="undo" color="accent" grade="inline" size={13} />
            <Text style={styles.counterBtnText}>Counter with a balanced offer</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

// A COMPLETED (accepted) trade — read-only history for the Sent tab. Same side-by-side treatment as
// an offer, minus the action buttons, with a green "COMPLETED" tag and the date it processed.
function CompletedTradeCard({ trade, onOpenPlayer }) {
  const when = trade.at ? new Date(trade.at * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: colors.good }]}>
      <View style={styles.cardTop}>
        <View style={[styles.dirPill, { borderColor: colors.good }]}>
          <Text style={[styles.dirPillText, { color: colors.good }]}>COMPLETED</Text>
        </View>
        <Text style={styles.cardFrom} numberOfLines={1}>
          <Text style={styles.cardDir}>with </Text>{trade.withName}
        </Text>
        {when ? <Text style={styles.completedWhen}>{when}</Text> : null}
      </View>
      <Side label="You got" assets={trade.acquire} total={trade.analysis && trade.analysis.acquireValue} tint={colors.good} onOpenPlayer={onOpenPlayer} />
      <Side label="You gave" assets={trade.send} total={trade.analysis && trade.analysis.sendValue} tint={colors.textDim} onOpenPlayer={onOpenPlayer} />
    </View>
  );
}

function Side({ label, assets, total, tint, onOpenPlayer }) {
  return (
    <View style={styles.side}>
      <Text style={styles.sideLabel}>{label} · <Text style={{ color: colors.gold }}>{total}</Text></Text>
      {assets.map((a) => {
        // Only players open a profile; picks and FAAB (blind-bid budget) aren't players.
        const faab = a.kind === 'faab' || a.position === 'FAAB';
        const tappable = onOpenPlayer && a.kind === 'player';
        const Row = tappable ? Pressable : View;
        const rowProps = tappable ? { onPress: () => onOpenPlayer(a.id) } : {};
        const meta = a.kind === 'pick'
          ? (a.value != null ? `val ${a.value}` : 'pick')
          : faab
          ? `budget${a.value != null ? ` · ${a.value}` : ''}`
          : `${a.position}${a.value != null ? ` · ${a.value}` : ''}`;
        return (
          <Row key={a.id} style={styles.sideRow} {...rowProps}>
            <View style={[styles.dot, { backgroundColor: faab ? colors.gold : (positionColors[a.position] || colors.textDim) }]} />
            <Text style={styles.sideName} numberOfLines={1}>{a.name}</Text>
            {/* Picks show "val N" (dynasty value 0–100), never a bare number that reads as a
                pick slot — future picks have no known slot until the draft order is set. */}
            <Text style={styles.sideMeta}>{meta}</Text>
          </Row>
        );
      })}
    </View>
  );
}

// Open text field to add blind-bidding budget (FAAB) to one side of the builder — type any dollar
// amount rather than stepping in fixed increments. Digits only; empty clears it to $0.
function FaabInput({ amount, onChange, tint }) {
  const [val, setVal] = useState(amount ? String(amount) : '');
  useEffect(() => { setVal(amount ? String(amount) : ''); }, [amount]);
  return (
    <View style={styles.faabRow}>
      <Text style={[styles.faabDollar, amount > 0 && { color: tint }]}>$</Text>
      <TextInput
        style={[styles.faabInput, amount > 0 && { color: tint, fontWeight: '800' }]}
        value={val}
        onChangeText={(t) => { const c = t.replace(/[^0-9]/g, '').slice(0, 5); setVal(c); onChange(c ? parseInt(c, 10) : 0); }}
        keyboardType="number-pad"
        placeholder="FAAB $"
        placeholderTextColor={colors.textDim}
        maxLength={5}
        returnKeyType="done"
      />
    </View>
  );
}

// "Mahomes, Patrick" -> "P. Mahomes". Comma-less names (picks, FAAB, single-token) pass through.
function shortName(full) {
  const s = String(full || '');
  const i = s.indexOf(',');
  if (i === -1) return s;
  const last = s.slice(0, i).trim();
  const first = s.slice(i + 1).trim();
  return first ? `${first[0]}. ${last}` : last;
}

function AssetRow({ asset, on, onPress, tint, compact }) {
  const posColor = positionColors[asset.position] || colors.textDim;
  // Texture: wash the row's side tint when it's added to the deal (§2.3) so the pick visibly lands.
  const flash = useActFlash(on ? 1 : 0);
  const wash = (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: compact ? 8 : 10, backgroundColor: tint, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }) }]}
    />
  );
  if (compact) {
    // Narrow two-column builder: checkbox + first-initial + last name, with pos · team · value on a
    // second line. Position color is a left border instead of a dot to save width.
    const meta = asset.kind === 'pick'
      ? 'pick'
      : [asset.position, asset.team].filter(Boolean).join(' · ');
    return (
      <Pressable
        style={({ pressed }) => [styles.cAssetRow, { borderLeftColor: posColor }, on && { borderColor: tint, backgroundColor: colors.cardAlt }, pressed && { opacity: 0.8 }]}
        onPress={onPress}
      >
        {wash}
        <View style={[styles.check, on && { backgroundColor: tint, borderColor: tint }]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cAssetName} numberOfLines={1}>{shortName(asset.name)}</Text>
          <Text style={styles.cAssetMeta} numberOfLines={1}>
            {meta}{asset.value != null ? ` · ${asset.value}` : ''}{asset.bait ? ' · ⇄' : ''}
          </Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable style={({ pressed }) => [styles.assetRow, on && { borderColor: tint, backgroundColor: colors.cardAlt }, pressed && { opacity: 0.8 }]} onPress={onPress}>
      {wash}
      <View style={[styles.check, on && { backgroundColor: tint, borderColor: tint }]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
      <View style={[styles.dot, { backgroundColor: posColor }]} />
      <Text style={styles.assetName} numberOfLines={1}>{asset.name}</Text>
      {asset.bait ? <Text style={styles.baitTag}>⇄ BLOCK</Text> : null}
      <Text style={styles.assetMeta}>{asset.kind === 'pick' ? 'Draft pick' : `${asset.position}${asset.team ? ` · ${asset.team}` : ''}`}</Text>
      <Text style={styles.assetValue}>{asset.value != null ? (asset.kind === 'pick' ? `val ${asset.value}` : asset.value) : '—'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sortRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 14, marginBottom: 2 },
  sortLabel: { color: colors.violetText, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginRight: 8 },
  sortChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginRight: 6 },
  sortChipOn: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  sortChipTxt: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  sortChipTxtOn: { color: colors.accent },
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', minWidth: 60 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
  formatNote: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 2 },
  segment: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 8, gap: 10 },
  deadlineLabel: { color: colors.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  deadlineEdit: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  deadlineVal: { color: colors.text, fontSize: 14, fontWeight: '800' },
  deadlineSrc: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  deadlineInput: { color: colors.text, fontSize: 14, fontWeight: '700', borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, minWidth: 118, backgroundColor: colors.card },
  deadlineSave: { paddingHorizontal: 4 },
  deadlineSaveTxt: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  deadlineCancel: { color: colors.textDim, fontSize: 16, fontWeight: '800' },
  deadlineEditBtn: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  deadlineClear: { color: colors.bad, fontSize: 13, fontWeight: '800' },
  deadlineSet: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  seg: { flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: colors.text },
  list: { padding: 16 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 30, fontSize: 14 },
  credit: { marginTop: 14, marginBottom: 4 },
  error: { color: colors.bad, textAlign: 'center', marginTop: 12, marginHorizontal: 24 },
  retry: { marginTop: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: colors.accent, fontWeight: '700' },
  label: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  fitPanel: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 12 },
  fitCol: { flex: 1 },
  fitDiv: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 12 },
  fitTeam: { color: colors.text, fontSize: 13, fontWeight: '900', marginBottom: 2 },
  fitMeta: { color: colors.textDim, fontSize: 11, fontWeight: '800', marginBottom: 6 },
  fitLine: { color: colors.text, fontSize: 12, marginTop: 2 },
  fitNeed: { color: colors.violetText, fontSize: 10, fontWeight: '800' },
  fitSurp: { color: colors.violetText, fontSize: 10, fontWeight: '800' },
  counterBanner: { backgroundColor: colors.cardAlt, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, padding: 12, marginBottom: 6 },
  counterTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  counterTitle: { color: colors.accent, fontSize: 13, fontWeight: '900' },
  counterText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  counterBtn: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10, alignItems: 'center' },
  counterBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  counterBtnText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  reviewBtn: { marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  reviewBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '800' },
  sendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  suggestBtn: { borderWidth: 1, borderColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 8 },
  suggestOff: { opacity: 0.4 },
  suggestTxt: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  // Full-width "suggest a package" button that sits above the two builder columns.
  suggestWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent, borderRadius: 10, paddingVertical: 11, marginHorizontal: 16, marginTop: 12, minHeight: 42 },
  suggestRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 10 },
  suggestHalf: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, minHeight: 44 },
  dealBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accent + '18', borderRadius: 10, paddingVertical: 12, marginHorizontal: 16, marginTop: 12, minHeight: 46 },
  dealBtnTxt: { color: colors.accent, fontSize: 14, fontWeight: '900' },
  // Two-column builder: your assets (left, check to send) vs theirs (right, check to get).
  buildCols: { flexDirection: 'row', marginHorizontal: 16, marginTop: 14 },
  buildCol: { flex: 1 },
  buildColDiv: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border, marginHorizontal: 8 },
  buildColLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  cAssetRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, paddingVertical: 8, paddingRight: 8, paddingLeft: 8, marginBottom: 7 },
  cAssetName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  cAssetMeta: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardFrom: { color: colors.text, fontSize: 16, fontWeight: '800', flex: 1, marginRight: 8 },
  cardDir: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  dirPill: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 8 },
  dirPillText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  completedToggle: { paddingVertical: 12, paddingHorizontal: 4, marginTop: 4 },
  completedToggleText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  completedWhen: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginLeft: 8 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  side: { marginTop: 8 },
  sideLabel: { color: colors.violetText, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  sideRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  sideName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  sideMeta: { color: colors.textDim, fontSize: 12 },
  personalLine: { fontSize: 12, fontWeight: '800', marginTop: 3 },
  // Consolidated value strip: the three "net" reads as one wrapping row of labeled chips.
  valueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4, marginTop: 10 },
  netChip: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  netChipLabel: { color: colors.textDim, fontSize: size.micro, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  netChipVal: { fontSize: size.bodySm, fontWeight: '900', fontVariant: ['tabular-nums'] },
  valueEst: { color: colors.textDim, fontSize: size.micro, fontStyle: 'italic', opacity: 0.7, marginLeft: 'auto' },
  tagNotes: { marginTop: 6, gap: 3 },
  tagNote: { fontSize: 12, fontWeight: '700' },
  construction: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8 },
  constructionText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  // The call — the decision anchor, sitting directly above the accept/reject buttons. Elevated a
  // touch (larger, more padding) so it reads as the recommendation, not another analysis line.
  bottomLine: { marginTop: 10, backgroundColor: colors.bg, borderLeftWidth: 3, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11 },
  bottomLineText: { fontSize: size.body, fontWeight: '800', lineHeight: 20 },
  buildFit: { marginBottom: 8, gap: 2 },
  buildFitLine: { fontSize: 12, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  noRespond: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  invalidBanner: { marginTop: 12, backgroundColor: colors.bad + '18', borderRadius: 10, borderWidth: 1, borderColor: colors.bad + '55', padding: 10 },
  invalidText: { color: colors.bad, fontSize: 12.5, fontWeight: '700', lineHeight: 17 },
  dismissBtn: { marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt, paddingVertical: 12, alignItems: 'center' },
  dismissText: { color: colors.text, fontSize: 14, fontWeight: '800' },
  faabRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  faabDollar: { color: colors.textDim, fontSize: 13, fontWeight: '800', marginRight: 2 },
  faabInput: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700', paddingVertical: 6, paddingHorizontal: 0 },
  act: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  reject: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rejectText: { color: colors.textDim, fontWeight: '800', fontSize: 14 },
  accept: { backgroundColor: colors.accent },
  acceptText: { color: colors.onAccent, fontWeight: '800', fontSize: 14 },
  // Reject-with-note modal.
  modalScrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', paddingHorizontal: 24 },
  rejectSheet: { backgroundColor: colors.bg, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18 },
  rejectTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  rejectHint: { color: colors.textDim, fontSize: 12, marginBottom: 12 },
  rejectInput: { minHeight: 64, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, fontSize: 14, padding: 10, textAlignVertical: 'top' },
  rejectActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  rejectCancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  rejectCancelText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  // Accept-with-drops sheet: bottom-anchored so the (long) player list has room; the scroll region is
  // capped so title + running count + actions stay visible above it.
  dropSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24, maxHeight: '82%' },
  dropTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 6 },
  dropHint: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  dropCount: { color: colors.textDim, fontSize: 13, fontWeight: '800', marginBottom: 8 },
  dropList: { flexGrow: 0 },
  dropRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  dropRowOn: { borderColor: colors.bad, backgroundColor: colors.cardAlt },
  dropName: { color: colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  dropMeta: { color: colors.textDim, fontSize: 12, marginLeft: 8 },
  dropActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  partnerRow: { gap: 8, paddingBottom: 4 },
  partnerChip: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, maxWidth: 190 },
  partnerChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  chipBait: { color: colors.accent, fontSize: 10, fontWeight: '800', marginTop: 2 },
  baitTag: { color: colors.accent, fontSize: 9, fontWeight: '900', marginLeft: 6, borderWidth: 1, borderColor: colors.accent, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1, overflow: 'hidden' },
  blockHint: { color: colors.gold, fontSize: 11, fontWeight: '800' },
  partnerText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  assetRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: colors.onAccent, fontWeight: '900', fontSize: 13 },
  assetName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  assetMeta: { color: colors.textDim, fontSize: 12, marginRight: 10 },
  assetValue: { color: colors.gold, fontSize: 14, fontWeight: '900', minWidth: 26, textAlign: 'right' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, padding: 16 },
  recap: { marginBottom: 8, gap: 2 },
  recapLine: { color: colors.textDim, fontSize: 12, lineHeight: 16 },
  recapGet: { color: colors.good, fontWeight: '800' },
  recapSend: { color: colors.accent, fontWeight: '800' },
  tendencyNote: { color: colors.textDim, fontSize: 12, fontStyle: 'italic', marginBottom: 8 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  previewText: { color: colors.textDim, fontSize: 13 },
  previewStrong: { color: colors.text, fontWeight: '800' },
  previewVerdict: { fontSize: 13, fontWeight: '800' },
  send: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  sendOff: { backgroundColor: colors.cardAlt },
  sendText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
});
