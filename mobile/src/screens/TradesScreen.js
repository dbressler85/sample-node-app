import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';

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

export default function TradesScreen({ league, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('offers');
  const [busy, setBusy] = useState(null); // offerId being responded to

  // Propose builder state.
  const [partnerId, setPartnerId] = useState(null);
  const [send, setSend] = useState({}); // token -> asset
  const [receive, setReceive] = useState({});
  const [sending, setSending] = useState(false);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.leagueTrades(league.leagueId);
      setData(d);
      if (!partnerId && d.partners && d.partners.length) setPartnerId(d.partners[0].franchiseId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [league.leagueId, partnerId]);

  useEffect(() => { load(); }, [load]);

  async function respond(offer, action) {
    setBusy(offer.id);
    try {
      await api.respondTrade(league.leagueId, offer.id, action);
      await load();
    } catch (e) {
      Alert.alert('Could not respond', e.message);
    } finally {
      setBusy(null);
    }
  }

  const partner = useMemo(() => (data && data.partners || []).find((p) => p.franchiseId === partnerId) || null, [data, partnerId]);
  const sendList = Object.values(send);
  const receiveList = Object.values(receive);
  const preview = useMemo(() => analyze(receiveList, sendList), [receiveList, sendList]);

  function toggle(setFn, obj, asset) {
    setFn((cur) => {
      const next = { ...cur };
      if (next[asset.id]) delete next[asset.id];
      else next[asset.id] = asset;
      return next;
    });
  }
  // Reset the "you get" side when switching partners.
  function pickPartner(id) {
    setPartnerId(id);
    setReceive({});
  }

  async function submitProposal() {
    setSending(true);
    try {
      const res = await api.proposeTrade(league.leagueId, {
        toFranchiseId: partnerId,
        give: sendList.map((a) => a.id),
        receive: receiveList.map((a) => a.id),
      });
      Alert.alert('Trade proposed', `Sent to ${res.offer.withName}.`);
      setSend({});
      setReceive({});
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
              <OfferCard key={o.id} offer={o} busy={busy === o.id} onRespond={respond} />
            ))
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.label}>Trade with</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.partnerRow}>
            {(data.partners || []).map((p) => (
              <Pressable key={p.franchiseId} style={[styles.partnerChip, partnerId === p.franchiseId && styles.partnerChipActive]} onPress={() => pickPartner(p.franchiseId)}>
                <Text style={[styles.partnerText, partnerId === p.franchiseId && { color: colors.text }]} numberOfLines={1}>{p.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.label}>You get {receiveList.length ? `· ${preview.acquireValue}` : ''}</Text>
          {partner ? partner.players.map((a) => (
            <AssetRow key={a.id} asset={a} on={!!receive[a.id]} onPress={() => toggle(setReceive, receive, a)} tint={colors.good} />
          )) : <Text style={styles.empty}>Pick a team above.</Text>}

          <Text style={styles.label}>You send {sendList.length ? `· ${preview.sendValue}` : ''}</Text>
          {(data.myPlayers || []).map((a) => (
            <AssetRow key={a.id} asset={a} on={!!send[a.id]} onPress={() => toggle(setSend, send, a)} tint={colors.accent} />
          ))}
          {(data.myPicks || []).map((a) => (
            <AssetRow key={a.id} asset={a} on={!!send[a.id]} onPress={() => toggle(setSend, send, a)} tint={colors.accent} />
          ))}
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {tab === 'propose' ? (
        <View style={styles.footer}>
          <View style={styles.previewRow}>
            <Text style={styles.previewText}>
              You get <Text style={styles.previewStrong}>{preview.acquireValue}</Text> · send <Text style={styles.previewStrong}>{preview.sendValue}</Text>
            </Text>
            <Text style={[styles.previewVerdict, { color: VERDICT[preview.verdict].color }]}>{VERDICT[preview.verdict].label}</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.send, (!sendList.length || !receiveList.length || sending) && styles.sendOff, pressed && { opacity: 0.85 }]}
            onPress={submitProposal}
            disabled={!sendList.length || !receiveList.length || sending}
          >
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Propose Trade</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function OfferCard({ offer, busy, onRespond }) {
  const v = VERDICT[offer.analysis.verdict] || VERDICT.fair;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardFrom} numberOfLines={1}>{offer.withName}</Text>
        <View style={[styles.badge, { borderColor: v.color }]}>
          <Text style={[styles.badgeText, { color: v.color }]}>{v.label}</Text>
        </View>
      </View>
      <Side label="You get" assets={offer.acquire} total={offer.analysis.acquireValue} tint={colors.good} />
      <Side label="You give" assets={offer.send} total={offer.analysis.sendValue} tint={colors.textDim} />
      <View style={styles.cardActions}>
        <Pressable style={[styles.act, styles.reject]} onPress={() => onRespond(offer, 'reject')} disabled={busy}>
          <Text style={styles.rejectText}>Reject</Text>
        </Pressable>
        <Pressable style={[styles.act, styles.accept]} onPress={() => onRespond(offer, 'accept')} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Accept</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Side({ label, assets, total, tint }) {
  return (
    <View style={styles.side}>
      <Text style={styles.sideLabel}>{label} · {total}</Text>
      {assets.map((a) => (
        <View key={a.id} style={styles.sideRow}>
          <View style={[styles.dot, { backgroundColor: positionColors[a.position] || colors.textDim }]} />
          <Text style={styles.sideName} numberOfLines={1}>{a.name}</Text>
          <Text style={styles.sideMeta}>{a.position}{a.value != null ? ` · ${a.value}` : ''}</Text>
        </View>
      ))}
    </View>
  );
}

function AssetRow({ asset, on, onPress, tint }) {
  return (
    <Pressable style={({ pressed }) => [styles.assetRow, on && { borderColor: tint, backgroundColor: colors.cardAlt }, pressed && { opacity: 0.8 }]} onPress={onPress}>
      <View style={[styles.check, on && { backgroundColor: tint, borderColor: tint }]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
      <View style={[styles.dot, { backgroundColor: positionColors[asset.position] || colors.textDim }]} />
      <Text style={styles.assetName} numberOfLines={1}>{asset.name}</Text>
      <Text style={styles.assetMeta}>{asset.position}{asset.team ? ` · ${asset.team}` : ''}</Text>
      <Text style={styles.assetValue}>{asset.value != null ? asset.value : '—'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
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
  cardActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  act: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  reject: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rejectText: { color: colors.textDim, fontWeight: '800', fontSize: 14 },
  accept: { backgroundColor: colors.good },
  acceptText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  partnerRow: { gap: 8, paddingBottom: 4 },
  partnerChip: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, maxWidth: 180 },
  partnerChipActive: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  partnerText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  assetRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 13 },
  assetName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  assetMeta: { color: colors.textDim, fontSize: 12, marginRight: 10 },
  assetValue: { color: colors.gold, fontSize: 14, fontWeight: '900', minWidth: 26, textAlign: 'right' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, padding: 16 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  previewText: { color: colors.textDim, fontSize: 13 },
  previewStrong: { color: colors.text, fontWeight: '800' },
  previewVerdict: { fontSize: 13, fontWeight: '800' },
  send: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  sendOff: { backgroundColor: colors.cardAlt },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
