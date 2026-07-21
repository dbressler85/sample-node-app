import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import { celebrate } from '../components/Celebrate';
import useAndroidBack from '../useAndroidBack';

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

// Live roster-construction read for the builder (mirrors the backend tradefit verdict).
// give/receive are asset lists from THIS team's side; subject phrases it ('you' | 'they').
function constructionOf(give, receive, needs, surplus, subject, posDepth) {
  const you = subject !== 'they';
  const needSet = new Set((needs || []).map((n) => n.pos));
  const surSet = new Set((surplus || []).map((s) => s.pos));
  const gNeed = give.filter((p) => needSet.has(p.position));
  const gSurp = give.filter((p) => surSet.has(p.position));
  const rNeed = receive.filter((p) => needSet.has(p.position));
  const rSurp = receive.filter((p) => surSet.has(p.position));
  const score = rNeed.length * 2 + gSurp.length - gNeed.length * 2 - rSurp.length * 0.5;
  const fills = [...new Set(rNeed.map((p) => p.position))];
  const thins = [...new Set(gNeed.map((p) => p.position))];
  const depth = [...new Set(gSurp.map((p) => p.position))];
  const j = (a) => a.join('/');
  // Hole detection (mirrors backend tradefit): a deal that drops a starting spot below
  // its startable count, even when that spot wasn't a pre-existing need.
  const holes = [];
  if (posDepth) {
    const byPos = {};
    for (const p of give) if (p && p.position) (byPos[p.position] || (byPos[p.position] = [])).push(p);
    for (const pos of Object.keys(byPos)) {
      const d = posDepth[pos];
      if (!d) continue;
      const gaveStartable = byPos[pos].filter((p) => p.value != null && p.value >= d.threshold).length;
      if (!gaveStartable) continue;
      const recvStartable = receive.filter((p) => p.position === pos && p.value != null && p.value >= d.threshold).length;
      if (d.startable - gaveStartable + recvStartable < d.slots) holes.push(pos);
    }
  }
  if (holes.length) return { rating: 'caution', reason: you ? `Leaves you with no startable ${j(holes)} — replace the spot first` : `Strips their ${j(holes)} starter` };
  if (thins.length && !fills.length) return { rating: 'caution', reason: you ? `Ships a ${j(thins)} you're thin at` : `Costs them a ${j(thins)} they need` };
  if (score >= 2) {
    if (you) return { rating: 'good', reason: fills.length ? `Fills your ${j(fills)} need${depth.length ? ` from ${j(depth)} depth` : ''}` : `From your ${j(depth)} depth` };
    return { rating: 'good', reason: fills.length ? `Fills their ${j(fills)} need — likely to bite` : `From their ${j(depth)} depth` };
  }
  if (score <= -1) return { rating: 'caution', reason: you ? (thins.length ? `Thins your ${j(thins)}` : 'Onto your strength') : (thins.length ? `Thins their ${j(thins)}` : 'Onto their strength') };
  return { rating: 'neutral', reason: you ? 'Roster-neutral' : 'Neutral for them' };
}

const VERDICT = {
  favorable: { label: 'You gain value', color: colors.good },
  fair: { label: 'Fair deal', color: colors.textDim },
  unfavorable: { label: 'You give up value', color: colors.bad },
};

// Local value analysis for the live proposal preview (mirrors the backend).
function analyze(receive, send) {
  const sum = (a) => Math.round(a.reduce((s, x) => s + (x.value || 0), 0) * 10) / 10;
  const acquireValue = sum(receive);
  const sendValue = sum(send);
  const net = Math.round((acquireValue - sendValue) * 10) / 10;
  const scale = Math.max(acquireValue, sendValue, 1);
  const ratio = net / scale;
  let verdict = 'fair';
  if (net > 5 && ratio > 0.12) verdict = 'favorable';
  else if (net < -5 && ratio < -0.12) verdict = 'unfavorable';
  return { acquireValue, sendValue, net, verdict };
}

// Personal-value lens: the same analysis over Target/Avoid-adjusted values. Returns null
// when nothing in the deal is tagged (so the UI only shows the "for you" line when it
// actually differs from the market read).
const TAG_MOD = { target: 1.1, avoid: 0.9 };
function personalAnalyze(receive, send) {
  if (![...receive, ...send].some((x) => x.tag)) return null;
  const scale = (arr) => arr.map((x) => ({ ...x, value: (x.value || 0) * (TAG_MOD[x.tag] || 1) }));
  return analyze(scale(receive), scale(send));
}

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

export default function TradesScreen({ league, onBack, initialTab, seed, onOpenPlayer, onSent }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initialTab === 'propose' ? 'propose' : 'offers');
  const [busy, setBusy] = useState(null); // offerId being responded to

  // Propose builder state.
  const [partnerId, setPartnerId] = useState(null);
  const [send, setSend] = useState({}); // token -> asset
  const [receive, setReceive] = useState({});
  const [sending, setSending] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [counterInfo, setCounterInfo] = useState(null); // { offerId, rationale } when countering
  const [sortKey, setSortKey] = useState('position'); // offer lists: position | value | name
  const seededRef = useRef(false);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.leagueTrades(league.leagueId);
      setData(d);
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

  async function respond(offer, action) {
    setBusy(offer.id);
    try {
      await api.respondTrade(league.leagueId, offer.id, action);
      celebrate(action === 'accept' ? 'tradeAccepted' : 'offerRejected');
      await load();
    } catch (e) {
      Alert.alert('Could not respond', e.message);
    } finally {
      setBusy(null);
    }
  }

  const partner = useMemo(() => (data && data.partners || []).find((p) => p.franchiseId === partnerId) || null, [data, partnerId]);
  const receiveOptions = useMemo(() => sortAssets(partner ? partner.players : [], sortKey), [partner, sortKey]);
  const sendOptions = useMemo(() => sortAssets([...((data && data.myPlayers) || []), ...((data && data.myPicks) || [])], sortKey), [data, sortKey]);
  const sendList = Object.values(send);
  const receiveList = Object.values(receive);
  const preview = useMemo(() => analyze(receiveList, sendList), [receiveList, sendList]);
  const personalPreview = useMemo(() => personalAnalyze(receiveList, sendList), [receiveList, sendList]);
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
  // Reset the "you get" side when switching partners (and drop any counter context).
  function pickPartner(id) {
    setPartnerId(id);
    setReceive({});
    setCounterInfo(null);
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
    const partner = (data.partners || []).find((p) => p.franchiseId === seed.partnerFranchiseId);
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
      Alert.alert(counterInfo ? 'Counter sent' : 'Trade proposed', `Sent to ${res.offer.withName}.${counterInfo ? ' Their original offer was declined.' : ''}`);
      setSend({});
      setReceive({});
      setCounterInfo(null);
      setTab('offers');
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
        {[['offers', `Offers${data && data.offers.length ? ` · ${data.offers.length}` : ''}`], ['propose', 'Propose']].map(([k, label]) => (
          <Pressable key={k} style={[styles.seg, tab === k && styles.segActive]} onPress={() => setTab(k)}>
            <Text style={[styles.segText, tab === k && styles.segTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {tab === 'offers' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {data.offers.length === 0 ? (
            <Text style={styles.empty}>No pending trade offers in this league.</Text>
          ) : (
            data.offers.map((o) => (
              <OfferCard key={o.id} offer={o} busy={busy === o.id} onRespond={respond} onCounter={startCounter} onOpenPlayer={onOpenPlayer} />
            ))
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {counterInfo ? (
            <View style={styles.counterBanner}>
              <Text style={styles.counterTitle}>↩ Countering their offer</Text>
              <Text style={styles.counterText}>{counterInfo.rationale}</Text>
            </View>
          ) : null}
          <Text style={styles.label}>Trade with</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.partnerRow}>
            {(data.partners || []).map((p) => (
              <Pressable key={p.franchiseId} style={[styles.partnerChip, partnerId === p.franchiseId && styles.partnerChipActive]} onPress={() => pickPartner(p.franchiseId)}>
                <Text style={[styles.partnerText, partnerId === p.franchiseId && { color: colors.text }]} numberOfLines={1}>{p.name}</Text>
                {p.baitCount > 0 ? <Text style={styles.chipBait} numberOfLines={1}>🎣 {p.baitCount} on the block</Text> : null}
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

          <Text style={styles.label}>
            You get {receiveList.length ? `· ${preview.acquireValue}` : ''}
            {partner && partner.baitCount > 0 ? <Text style={styles.blockHint}>{`  🎣 ${partner.baitCount} on the block`}</Text> : null}
          </Text>
          {partner ? receiveOptions.map((a) => (
            <AssetRow key={a.id} asset={a} on={!!receive[a.id]} onPress={() => toggle(setReceive, receive, a)} tint={colors.good} />
          )) : <Text style={styles.empty}>Pick a team above.</Text>}

          <View style={styles.sendHead}>
            <Text style={styles.label}>You send {sendList.length ? `· ${preview.sendValue}` : ''}</Text>
            <Pressable
              onPress={() => applySuggestion()}
              disabled={!receiveList.length || suggesting}
              style={({ pressed }) => [styles.suggestBtn, (!receiveList.length || suggesting) && styles.suggestOff, pressed && { opacity: 0.8 }]}
            >
              {suggesting ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.suggestTxt}>✦ Suggest</Text>}
            </Pressable>
          </View>
          {sendOptions.map((a) => (
            <AssetRow key={a.id} asset={a} on={!!send[a.id]} onPress={() => toggle(setSend, send, a)} tint={colors.accent} />
          ))}
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {tab === 'propose' ? (
        <View style={styles.footer}>
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
            <View style={styles.recap}>
              <Text style={styles.recapLine} numberOfLines={2}><Text style={styles.recapGet}>Get </Text>{receiveList.map((a) => a.name).join(', ') || '—'}</Text>
              <Text style={styles.recapLine} numberOfLines={2}><Text style={styles.recapSend}>Send </Text>{sendList.map((a) => a.name).join(', ') || '—'}</Text>
            </View>
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
    </View>
  );
}

function OfferCard({ offer, busy, onRespond, onCounter, onOpenPlayer }) {
  const v = VERDICT[offer.analysis.verdict] || VERDICT.fair;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardFrom} numberOfLines={1}>{offer.withName}</Text>
        <View style={[styles.badge, { borderColor: v.color }]}>
          <Text style={[styles.badgeText, { color: v.color }]}>{v.label}</Text>
        </View>
      </View>
      <Side label="You get" assets={offer.acquire} total={offer.analysis.acquireValue} tint={colors.good} onOpenPlayer={onOpenPlayer} />
      <Side label="You give" assets={offer.send} total={offer.analysis.sendValue} tint={colors.textDim} onOpenPlayer={onOpenPlayer} />
      <Text style={styles.estCaption}>
        Market value · net {offer.analysis.net > 0 ? '+' : ''}{offer.analysis.net}
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
        <View style={[styles.construction, { borderColor: (CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).color }]}>
          <Text style={[styles.constructionText, { color: (CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).color }]}>
            {(CONSTRUCTION[offer.construction.rating] || CONSTRUCTION.neutral).icon} {offer.direction === 'outgoing' ? 'You — ' : ''}{offer.construction.reason}
          </Text>
          {offer.direction === 'outgoing' && offer.partnerConstruction ? (
            <Text style={[styles.constructionText, { color: (CONSTRUCTION[offer.partnerConstruction.rating] || CONSTRUCTION.neutral).color, marginTop: 4 }]}>
              {(CONSTRUCTION[offer.partnerConstruction.rating] || CONSTRUCTION.neutral).icon} {offer.withName} — {offer.partnerConstruction.reason}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.cardActions}>
        <Pressable style={[styles.act, styles.reject]} onPress={() => onRespond(offer, 'reject')} disabled={busy}>
          <Text style={styles.rejectText}>Reject</Text>
        </Pressable>
        <Pressable style={[styles.act, styles.accept]} onPress={() => onRespond(offer, 'accept')} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Accept</Text>}
        </Pressable>
      </View>
      {onCounter ? (
        <Pressable style={({ pressed }) => [styles.counterBtn, pressed && { opacity: 0.7 }]} onPress={() => onCounter(offer)} disabled={busy}>
          <Text style={styles.counterBtnText}>↩ Counter with a balanced offer</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Side({ label, assets, total, tint, onOpenPlayer }) {
  return (
    <View style={styles.side}>
      <Text style={styles.sideLabel}>{label} · {total}</Text>
      {assets.map((a) => {
        // Players open their cross-league profile; picks aren't players, so they stay inert.
        const tappable = onOpenPlayer && a.kind !== 'pick';
        const Row = tappable ? Pressable : View;
        const rowProps = tappable ? { onPress: () => onOpenPlayer(a.id) } : {};
        return (
          <Row key={a.id} style={styles.sideRow} {...rowProps}>
            <View style={[styles.dot, { backgroundColor: positionColors[a.position] || colors.textDim }]} />
            <Text style={styles.sideName} numberOfLines={1}>{a.name}</Text>
            {/* Picks show "val N" (dynasty value 0–100), never a bare number that reads as a
                pick slot — future picks have no known slot until the draft order is set. */}
            <Text style={styles.sideMeta}>{a.kind === 'pick' ? (a.value != null ? `val ${a.value}` : 'pick') : `${a.position}${a.value != null ? ` · ${a.value}` : ''}`}</Text>
          </Row>
        );
      })}
    </View>
  );
}

function AssetRow({ asset, on, onPress, tint }) {
  return (
    <Pressable style={({ pressed }) => [styles.assetRow, on && { borderColor: tint, backgroundColor: colors.cardAlt }, pressed && { opacity: 0.8 }]} onPress={onPress}>
      <View style={[styles.check, on && { backgroundColor: tint, borderColor: tint }]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
      <View style={[styles.dot, { backgroundColor: positionColors[asset.position] || colors.textDim }]} />
      <Text style={styles.assetName} numberOfLines={1}>{asset.name}</Text>
      {asset.bait ? <Text style={styles.baitTag}>🎣 BLOCK</Text> : null}
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
  sendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  suggestBtn: { borderWidth: 1, borderColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 8 },
  suggestOff: { opacity: 0.4 },
  suggestTxt: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardFrom: { color: colors.text, fontSize: 16, fontWeight: '800', flex: 1, marginRight: 8 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  side: { marginTop: 8 },
  sideLabel: { color: colors.textDim, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  sideRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  sideName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  sideMeta: { color: colors.textDim, fontSize: 12 },
  estCaption: { color: colors.textDim, fontSize: 11, marginTop: 8 },
  personalLine: { fontSize: 12, fontWeight: '800', marginTop: 3 },
  tagNotes: { marginTop: 6, gap: 3 },
  tagNote: { fontSize: 12, fontWeight: '700' },
  construction: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8 },
  constructionText: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  buildFit: { marginBottom: 8, gap: 2 },
  buildFitLine: { fontSize: 12, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  act: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  reject: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rejectText: { color: colors.textDim, fontWeight: '800', fontSize: 14 },
  accept: { backgroundColor: colors.good },
  acceptText: { color: '#fff', fontWeight: '800', fontSize: 14 },
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
