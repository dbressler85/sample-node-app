import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';

// Cross-league trade inbox: every pending incoming offer across all your leagues,
// value-ranked, with accept/reject inline — instead of opening each league one by
// one. Drills into a league's full trade desk for context or to build a counter.

const VERDICT = {
  favorable: { label: 'You gain value', color: colors.good },
  fair: { label: 'Fair deal', color: colors.textDim },
  unfavorable: { label: 'You give up value', color: colors.bad },
};
const VRANK = { favorable: 0, fair: 1, unfavorable: 2 };

export default function TradeInboxScreen({ onBack, onOpenLeague, onProposeInLeague }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // `${leagueId}:${offerId}` being responded to

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.trades());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function respond(offer, action) {
    const k = `${offer.leagueId}:${offer.id}`;
    setBusy(k);
    try {
      await api.respondTrade(offer.leagueId, offer.id, action);
      await load();
    } catch (e) {
      Alert.alert('Could not respond', e.message);
    } finally {
      setBusy(null);
    }
  }

  // Best deals first: favorable → fair → unfavorable, then by net value. Memoized
  // so the sort doesn't re-run on every unrelated re-render (busy/refresh flips).
  const offers = useMemo(
    () => (data && data.offers ? [...data.offers] : []).sort(
      (a, b) => (VRANK[a.analysis.verdict] - VRANK[b.analysis.verdict]) || (b.analysis.net - a.analysis.net)
    ),
    [data]
  );
  const summary = data && data.summary;
  const leagues = (data && data.leagues) || [];

  // The hub is also where you START a trade: pick any league and open its desk on
  // the Propose tab. Without this, an empty inbox is a dead end and proposing is
  // buried under a league's roster.
  const startTrade = (
    <View style={styles.startWrap}>
      <Text style={styles.startTitle}>Start a trade</Text>
      <Text style={styles.startSub}>Pick a league to build and send an offer.</Text>
      {leagues.map((l) => (
        <Pressable
          key={l.leagueId}
          style={({ pressed }) => [styles.startRow, pressed && { opacity: 0.7 }]}
          onPress={() => (onProposeInLeague || onOpenLeague)({ leagueId: l.leagueId, name: l.name })}
        >
          <Text style={styles.startName} numberOfLines={1}>{l.name}</Text>
          <Text style={styles.startCta}>Propose ›</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Home</Text>
        </Pressable>
        <Text style={styles.title}>Trade Inbox</Text>
        <View style={{ width: 54 }} />
      </View>
      {summary ? (
        <Text style={styles.subtitle}>
          {summary.count} offer{summary.count === 1 ? '' : 's'} across your leagues
          {summary.favorable ? <Text style={{ color: colors.good, fontWeight: '800' }}>{`  ·  ${summary.favorable} favorable`}</Text> : null}
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(o) => `${o.leagueId}:${o.id}`}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          renderItem={({ item }) => (
            <OfferCard
              offer={item}
              busy={busy === `${item.leagueId}:${item.id}`}
              onRespond={respond}
              onOpenLeague={() => onOpenLeague({ leagueId: item.leagueId, name: item.leagueName })}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>🎉 Inbox zero</Text>
              <Text style={styles.emptyText}>No pending trade offers across your leagues right now.</Text>
            </View>
          }
          ListFooterComponent={leagues.length ? startTrade : null}
        />
      )}
    </View>
  );
}

function OfferCard({ offer, busy, onRespond, onOpenLeague }) {
  const v = VERDICT[offer.analysis.verdict] || VERDICT.fair;
  return (
    <View style={styles.card}>
      <Pressable style={({ pressed }) => [styles.leagueRow, pressed && { opacity: 0.7 }]} onPress={onOpenLeague}>
        <Text style={styles.leagueName} numberOfLines={1}>{offer.leagueName}</Text>
        <Text style={styles.deskLink}>Desk ›</Text>
      </Pressable>
      <View style={styles.cardTop}>
        <Text style={styles.from} numberOfLines={1}>from {offer.withName}</Text>
        <View style={[styles.badge, { borderColor: v.color }]}>
          <Text style={[styles.badgeText, { color: v.color }]}>{v.label}</Text>
        </View>
      </View>

      <Side label="You get" assets={offer.acquire} total={offer.analysis.acquireValue} />
      <Side label="You give" assets={offer.send} total={offer.analysis.sendValue} />
      <Text style={styles.estCaption}>
        Dynasty value estimate · net {offer.analysis.net > 0 ? '+' : ''}{offer.analysis.net}
      </Text>

      <View style={styles.actions}>
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

function Side({ label, assets, total }) {
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 54 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, marginBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  leagueName: { color: colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.3, flex: 1, marginRight: 10, textTransform: 'uppercase' },
  deskLink: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  from: { color: colors.textDim, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  side: { marginBottom: 10 },
  sideLabel: { color: colors.textDim, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  sideRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  sideName: { color: colors.text, fontSize: 14, flex: 1, marginRight: 8 },
  sideMeta: { color: colors.textDim, fontSize: 12 },
  estCaption: { color: colors.textDim, fontSize: 11, fontStyle: 'italic', opacity: 0.8, marginTop: 2, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  act: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  reject: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  rejectText: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  accept: { backgroundColor: colors.accent },
  acceptText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  error: { color: colors.bad, textAlign: 'center' },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: 20 },
  startWrap: { marginTop: 8, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  startTitle: { color: colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 0.3, textTransform: 'uppercase' },
  startSub: { color: colors.textDim, fontSize: 13, marginTop: 3, marginBottom: 12 },
  startRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10 },
  startName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 10 },
  startCta: { color: colors.accent, fontSize: 14, fontWeight: '800' },
});
