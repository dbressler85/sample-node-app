import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { api } from '../api';
import tradeMath from '../tradeMath';
import { colors, positionColors } from '../theme';
import { celebrate } from '../components/Celebrate';
import { toast } from '../components/Toast';
import TradeColumns from '../components/TradeColumns';
import Reveal from '../components/Reveal';
import useAndroidBack from '../useAndroidBack';
import { peekResource, primeResource } from '../useCachedResource';

const posList = (arr) => (arr && arr.length ? arr.map((x) => x.pos).join(', ') : '—');

// Sortable asset lists on the offer builder. Position groups run QB→RB→WR→TE→K/DEF→picks
// (picks last), value within a group descending; value sorts high→low; name A→Z.
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, PK: 4, DEF: 5, PICK: 9 };
function sortAssets(list, key) {
  const arr = [...(list || [])];
  if (key === 'name') return arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (key === 'value') return arr.sort((a, b) => (b.value || 0) - (a.value || 0));
  return arr.sort((a, b) => {
    const pa = POS_ORDER[a.position] != null ? POS_ORDER[a.position] : 6;
    const pb = POS_ORDER[b.position] != null ? POS_ORDER[b.position] : 6;
    return pa - pb || (b.value || 0) - (a.value || 0);
  });
}
const SORTS = [['position', 'Pos'], ['value', 'Market'], ['name', 'Name']];
const CONSTRUCTION = {
  good: { color: colors.good, icon: '✓' },
  caution: { color: colors.bad, icon: '⚠' },
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
  // Seed the desk read (partners, my players/picks, offers) from the survive-remount cache, keyed
  // per league — reopening a league's desk paints instantly instead of a cold spinner. In-progress
  // BUILD state (send/receive/faab) is intentionally NOT cached: each open starts a fresh offer.
  const deskKey = `trades:desk:${league.leagueId}`;
  const [data, setData] = useState(() => (peekResource(deskKey) ? peekResource(deskKey).value : null));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(() => !peekResource(deskKey));
  const [tab, setTab] = useState(initialTab === 'propose' ? 'propose' : 'inbox');
  const [busy, setBusy] = useState(null); // offerId being responded to
  const [rejectTarget, setRejectTarget] = useState(null); // offer being rejected (optional note modal)
  const [rejectNote, setRejectNote] = useState('');
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
      Alert.alert('Could not save', e.message);
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
      // Default the partner only if none is chosen — prefer the seeded partner (the
      // team that holds the player you came to trade for), else the first.
      if (d.partners && d.partners.length) setPartnerId((cur) => cur || (seed && seed.partnerFranchiseId) || d.partners[0].franchiseId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [league.leagueId]);

  useEffect(() => { load(); }, [load]);

  // As soon as desk data is available (cached or freshly loaded), make sure a partner is selected —
  // defensive complement to the lazy init + load()'s default, so the fit panel + "you get" list never
  // sit on "Pick a team above" while data is present.
  useEffect(() => {
    if (data && data.partners && data.partners.length) {
      setPartnerId((cur) => cur || (seed && seed.partnerFranchiseId) || data.partners[0].franchiseId);
    }
  }, [data, seed]);

  async function respond(offer, action, comments) {
    setBusy(offer.id);
    try {
      await api.respondTrade(league.leagueId, offer.id, action, comments);
      celebrate(action === 'accept' ? 'tradeAccepted' : action === 'revoke' ? 'offerWithdrawn' : 'offerRejected');
      await load();
    } catch (e) {
      Alert.alert('Could not respond', e.message);
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
    Alert.alert('Withdraw offer?', `Pull back your offer to ${offer.withName || 'this team'}.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => respond(offer, 'revoke') },
    ]);
  }

  const partner = useMemo(() => (data && data.partners || []).find((p) => p.franchiseId === partnerId) || null, [data, partnerId]);
  const receiveOptions = useMemo(() => sortAssets(partner ? partner.players : [], sortKey), [partner, sortKey]);
  const sendOptions = useMemo(() => sortAssets([...((data && data.myPlayers) || []), ...((data && data.myPicks) || [])], sortKey), [data, sortKey]);
  const sendList = Object.values(send);
  const receiveList = Object.values(receive);
  // Split offers by direction so Inbox (offers TO me) and Sent (offers FROM me) live on separate
  // tabs — a mixed list makes it easy to mistake a sent offer for one you can accept.
  const allOffers = (data && data.offers) || [];
  const incomingOffers = allOffers.filter((o) => o.direction !== 'outgoing');
  const outgoingOffers = allOffers.filter((o) => o.direction === 'outgoing');
  const activeOffers = tab === 'sent' ? outgoingOffers : incomingOffers;
  const completedTrades = (data && data.completedTrades) || [];
  const preview = useMemo(() => tradeMath.analyze(receiveList, sendList), [receiveList, sendList]);
  const personalPreview = useMemo(() => tradeMath.personalAnalyze(receiveList, sendList), [receiveList, sendList]);
  // Live construction for BOTH sides of the offer being built.
  const buildFit = useMemo(() => {
    if (!partner || !sendList.length || !receiveList.length) return null;
    return {
      me: constructionOf(sendList, receiveList, data && data.me && data.me.needs, data && data.me && data.me.surplus, 'you', data && data.me && data.me.depth),
      them: constructionOf(receiveList, sendList, partner.needs, partner.surplus, 'they', partner.depth),
    };
  }, [partner, sendList, receiveList, data]);
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
      /* keep whatever's there */
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
      Alert.alert('Could not suggest an ask', e.message);
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
      Alert.alert('Could not build a deal', e.message);
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
      Alert.alert('Could not build a counter', e.message);
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
      // In the multi-league wizard, advance to the next league on OK instead of
      // resetting this desk (it unmounts as the wizard steps forward).
      if (onSent) {
        Alert.alert('Trade proposed', `Sent to ${res.offer.withName}.`, [{ text: 'Next league ›', onPress: onSent }]);
        return;
      }
      toast(`${counterInfo ? 'Counter sent' : 'Trade proposed'} · sent to ${res.offer.withName}${counterInfo ? ' (their offer declined)' : ''}`);
      setSend({});
      setReceive({});
      setCounterInfo(null);
      setTab('sent'); // land on Sent so the just-proposed offer is right there to review/withdraw
      await load();
    } catch (e) {
      Alert.alert('Could not propose', e.message);
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
          <Text style={styles.title} numberOfLines={1}>{league.name}</Text>
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
        <Text style={styles.title} numberOfLines={1}>{league.name}</Text>
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
        <Text style={styles.deadlineLabel}>Trade deadline</Text>
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
              onPress={() => /^\d{4}-\d{2}-\d{2}$/.test(deadlineInput.trim()) ? saveDeadline(deadlineInput.trim()) : Alert.alert('Enter a date', 'Use the format YYYY-MM-DD (e.g. 2026-11-15).')}
              disabled={savingDeadline}
              style={styles.deadlineSave}
            >
              {savingDeadline ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.deadlineSaveTxt}>Save</Text>}
            </Pressable>
            <Pressable onPress={() => setEditingDeadline(false)} hitSlop={8}><Text style={styles.deadlineCancel}>✕</Text></Pressable>
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
                <OfferCard offer={o} busy={busy === o.id} onAccept={(off) => respond(off, 'accept')} onReject={openReject} onWithdraw={withdraw} onCounter={startCounter} onOpenPlayer={onOpenPlayer} onReviewRoster={onOpenRoster ? () => onOpenRoster(league) : null} />
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
              <Text style={styles.counterTitle}>↩ Countering their offer</Text>
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
                {suggesting ? <ActivityIndicator size="small" color={colors.gold} /> : (
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
                  {suggesting ? <ActivityIndicator size="small" color={colors.good} /> : (
                    <Text style={[styles.suggestTxt, { color: colors.good }]} numberOfLines={2}>✦ {sendList.length ? 'Suggest what to ask for' : 'Pick what you send →'}</Text>
                  )}
                </Pressable>
              </View>

              {/* The builder itself, side by side: check YOUR players/picks on the left to send,
                  and THEIR players/picks on the right to get. */}
              <View style={styles.buildCols}>
                <View style={styles.buildCol}>
                  <Text style={styles.buildColLabel} numberOfLines={1}>YOU SEND{sendList.length ? ` · ${preview.sendValue}` : ''}</Text>
                  {sendOptions.map((a) => (
                    <AssetRow key={a.id} asset={a} on={!!send[a.id]} onPress={() => toggle(setSend, send, a)} tint={colors.accent} compact />
                  ))}
                  {/* FAAB is tradeable in most leagues — add blind-bid budget to your side. */}
                  <FaabInput amount={faabOf(send)} onChange={(n) => setFaab(setSend, n)} tint={colors.accent} />
                </View>
                <View style={styles.buildColDiv} />
                <View style={styles.buildCol}>
                  <Text style={styles.buildColLabel} numberOfLines={1}>YOU GET{receiveList.length ? ` · ${preview.acquireValue}` : ''}</Text>
                  {receiveOptions.map((a) => (
                    <AssetRow key={a.id} asset={a} on={!!receive[a.id]} onPress={() => toggle(setReceive, receive, a)} tint={colors.good} compact />
                  ))}
                  <FaabInput amount={faabOf(receive)} onChange={(n) => setFaab(setReceive, n)} tint={colors.good} />
                </View>
              </View>
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
          {personalPreview ? (
            <Text style={[styles.personalLine, { textAlign: 'right', color: VERDICT[personalPreview.verdict].color }]}>
              For you · net {personalPreview.net > 0 ? '+' : ''}{personalPreview.net} · {VERDICT[personalPreview.verdict].label}
            </Text>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.send, (!sendList.length || !receiveList.length || sending) && styles.sendOff, pressed && { opacity: 0.85 }]}
            onPress={submitProposal}
            disabled={!sendList.length || !receiveList.length || sending}
          >
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>{counterInfo ? 'Send Counter' : 'Propose Trade'}</Text>}
          </Pressable>
        </View>
      ) : null}

      {/* Reject an incoming offer, optionally with a note MFL delivers to the originator. */}
      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <Pressable style={styles.modalScrim} onPress={() => setRejectTarget(null)}>
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
              <Pressable style={[styles.act, styles.rejectCancel]} onPress={() => setRejectTarget(null)}>
                <Text style={styles.rejectCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.act, styles.reject]} onPress={confirmReject}>
                <Text style={styles.rejectText}>{rejectNote.trim() ? 'Reject + send note' : 'Reject'}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function OfferCard({ offer, busy, onAccept, onReject, onWithdraw, onCounter, onOpenPlayer, onReviewRoster }) {
  const v = VERDICT[offer.analysis.verdict] || VERDICT.fair;
  const outgoing = offer.direction === 'outgoing';
  // A colored left stripe + a direction pill so received-vs-sent reads instantly, even at a glance:
  // gold = you SENT it, blue = it came TO you.
  const dirColor = outgoing ? colors.gold : colors.accent;
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
      <Text style={styles.estCaption}>
        est. market value · net {offer.analysis.net > 0 ? '+' : ''}{offer.analysis.net}
      </Text>
      {offer.personal ? (
        <Text style={[styles.personalLine, { color: (VERDICT[offer.personal.verdict] || VERDICT.fair).color }]}>
          For you · net {offer.personal.net > 0 ? '+' : ''}{offer.personal.net} · {(VERDICT[offer.personal.verdict] || VERDICT.fair).label}
        </Text>
      ) : null}
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
      {offer.canRespond ? (
        // Incoming offer we're the target of → accept / reject (reject can carry a note), plus a
        // "Review roster" jump so you can see the rest of your team in context before deciding.
        <>
          {onReviewRoster ? (
            <Pressable style={({ pressed }) => [styles.reviewBtn, pressed && { opacity: 0.7 }]} onPress={onReviewRoster} disabled={busy}>
              <Text style={styles.reviewBtnText}>⌂ Review my roster in context</Text>
            </Pressable>
          ) : null}
          <View style={styles.cardActions}>
            <Pressable style={[styles.act, styles.reject]} onPress={() => onReject(offer)} disabled={busy}>
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
            <Pressable style={[styles.act, styles.accept]} onPress={() => onAccept(offer)} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Accept</Text>}
            </Pressable>
          </View>
        </>
      ) : offer.canRevoke ? (
        // Our own outgoing offer → withdraw it (revoke).
        <View style={styles.cardActions}>
          <Pressable style={[styles.act, styles.reject]} onPress={() => onWithdraw(offer)} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.bad} /> : <Text style={styles.rejectText}>Withdraw offer</Text>}
          </Pressable>
        </View>
      ) : (
        <Text style={styles.noRespond}>This offer can’t be actioned here — open it in MyFantasyLeague.</Text>
      )}
      {onCounter ? (
        <Pressable style={({ pressed }) => [styles.counterBtn, pressed && { opacity: 0.7 }]} onPress={() => onCounter(offer)} disabled={busy}>
          <Text style={styles.counterBtnText}>↩ Counter with a balanced offer</Text>
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
      <Text style={styles.sideLabel}>{label} · {total}</Text>
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
  sortLabel: { color: colors.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginRight: 8 },
  sortChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginRight: 6 },
  sortChipOn: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  sortChipTxt: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  sortChipTxtOn: { color: colors.accent },
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
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
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: colors.text },
  list: { padding: 16 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 30, fontSize: 14 },
  error: { color: colors.bad, textAlign: 'center', marginTop: 12, marginHorizontal: 24 },
  retry: { marginTop: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { color: colors.accent, fontWeight: '700' },
  label: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  fitPanel: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 12 },
  fitCol: { flex: 1 },
  fitDiv: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 12 },
  fitTeam: { color: colors.text, fontSize: 13, fontWeight: '900', marginBottom: 2 },
  fitMeta: { color: colors.gold, fontSize: 11, fontWeight: '800', marginBottom: 6 },
  fitLine: { color: colors.text, fontSize: 12, marginTop: 2 },
  fitNeed: { color: colors.bad, fontSize: 10, fontWeight: '800' },
  fitSurp: { color: colors.good, fontSize: 10, fontWeight: '800' },
  counterBanner: { backgroundColor: colors.cardAlt, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, padding: 12, marginBottom: 6 },
  counterTitle: { color: colors.accent, fontSize: 13, fontWeight: '900', marginBottom: 3 },
  counterText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  counterBtn: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10, alignItems: 'center' },
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
  dealBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.gold + '18', borderRadius: 10, paddingVertical: 12, marginHorizontal: 16, marginTop: 12, minHeight: 46 },
  dealBtnTxt: { color: colors.gold, fontSize: 14, fontWeight: '900' },
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
  sideLabel: { color: colors.textDim, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  sideRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  sideName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  sideMeta: { color: colors.textDim, fontSize: 12 },
  estCaption: { color: colors.textDim, fontSize: 10, marginTop: 8, fontStyle: 'italic', opacity: 0.75, textTransform: 'uppercase', letterSpacing: 0.3 },
  personalLine: { fontSize: 12, fontWeight: '800', marginTop: 3 },
  tagNotes: { marginTop: 6, gap: 3 },
  tagNote: { fontSize: 12, fontWeight: '700' },
  construction: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8 },
  constructionText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  bottomLine: { marginTop: 8, backgroundColor: colors.bg, borderLeftWidth: 3, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9 },
  bottomLineText: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  buildFit: { marginBottom: 8, gap: 2 },
  buildFitLine: { fontSize: 12, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  noRespond: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  faabRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card },
  faabDollar: { color: colors.textDim, fontSize: 13, fontWeight: '800', marginRight: 2 },
  faabInput: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700', paddingVertical: 6, paddingHorizontal: 0 },
  act: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  reject: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rejectText: { color: colors.textDim, fontWeight: '800', fontSize: 14 },
  accept: { backgroundColor: colors.good },
  acceptText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  // Reject-with-note modal.
  modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 24 },
  rejectSheet: { backgroundColor: colors.bg, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18 },
  rejectTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  rejectHint: { color: colors.textDim, fontSize: 12, marginBottom: 12 },
  rejectInput: { minHeight: 64, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, fontSize: 14, padding: 10, textAlignVertical: 'top' },
  rejectActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  rejectCancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  rejectCancelText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  partnerRow: { gap: 8, paddingBottom: 4 },
  partnerChip: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, maxWidth: 190 },
  partnerChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  chipBait: { color: colors.gold, fontSize: 10, fontWeight: '800', marginTop: 2 },
  baitTag: { color: colors.gold, fontSize: 9, fontWeight: '900', marginLeft: 6, borderWidth: 1, borderColor: colors.gold, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1, overflow: 'hidden' },
  blockHint: { color: colors.gold, fontSize: 11, fontWeight: '800' },
  partnerText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  assetRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 13 },
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
  sendText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
