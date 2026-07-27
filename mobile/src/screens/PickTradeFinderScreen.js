import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { colors } from '../theme';
import { displayLg, displayLabel } from '../typography';
import { api } from '../api';
import ErrorView from '../components/ErrorView';
import PressableScale from '../components/PressableScale';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';
import { Value } from '../components/Brand';

// The ranked-partner shortlist behind Pick Capital's Shop / Get-picks CTAs. Each row is a rival worth
// talking to for THIS intent, plus a pre-built, value-balanced suggested deal — tap it to open the
// trade desk seeded on that exact deal.
//   • 'shop'    — cash your picks for a proven player: rebuilding teams with an aging valuable vet.
//   • 'acquire' — accumulate picks: win-now teams sitting on pick equity.

const OUTLOOK_COLOR = {
  'Win-now window': colors.warn,
  Ascending: colors.good,
  Rebuilding: colors.textDim,
  Balanced: colors.accent,
};
// My-perspective value verdict → tint. Favorable reads as a win, unfavorable as a caution.
const VERDICT = {
  favorable: { color: colors.good, label: 'You win value' },
  fair: { color: colors.textDim, label: 'Even value' },
  unfavorable: { color: colors.warn, label: 'You pay up' },
};

export default function PickTradeFinderScreen({ leagueId, name, intent, onBack, onOpenDeal }) {
  const shop = intent === 'shop';
  const { data, error, refreshing, loading, reload } = useCachedResource(
    `pickPartners:${leagueId}:${intent}`,
    () => api.pickPartners(leagueId, intent),
  );
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const partners = (data && data.partners) || [];

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Picks</Text></Pressable>
        <Text style={[styles.title, displayLg()]}>{shop ? 'Shop Your Picks' : 'Trade For Picks'}</Text>
        <View style={{ width: 60 }} />
      </View>
      <Text style={styles.subtitle} numberOfLines={1}>
        {name} · {shop ? 'send picks for a proven player' : 'send a player for pick equity'}
      </Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : !partners.length ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {shop
              ? 'No rebuilding teams with a gettable veteran right now.'
              : 'No win-now teams holding spare picks right now.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={partners}
          keyExtractor={(p) => p.franchiseId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          renderItem={({ item }) => <PartnerCard p={item} onOpenDeal={onOpenDeal} />}
          ListHeaderComponent={<Text style={styles.listHead}>Best-fit partners · richest first</Text>}
        />
      )}
    </View>
  );
}

function AssetChips({ assets }) {
  return (
    <View style={styles.assetWrap}>
      {assets.map((a, i) => (
        <View key={`${a.id}:${i}`} style={[styles.asset, a.kind === 'pick' && styles.assetPick]}>
          <Text style={styles.assetName} numberOfLines={1}>{a.name}</Text>
          {a.value != null ? <Text style={styles.assetVal}>{a.value}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function PartnerCard({ p, onOpenDeal }) {
  const outlookColor = OUTLOOK_COLOR[p.outlook] || colors.textDim;
  const verdict = VERDICT[p.deal.verdict] || VERDICT.fair;
  const open = () =>
    onOpenDeal({
      partnerFranchiseId: p.franchiseId,
      sendTokens: p.deal.send.map((a) => a.id),
      receiveTokens: p.deal.receive.map((a) => a.id),
    });
  return (
    <PressableScale style={styles.card} onPress={open}>
      <View style={styles.cardTop}>
        <Text style={[styles.team, displayLabel()]} numberOfLines={1}>{p.name}</Text>
        {p.outlook ? (
          <View style={[styles.chip, { borderColor: outlookColor }]}>
            <View style={[styles.dot, { backgroundColor: outlookColor }]} />
            <Text style={[styles.chipText, { color: outlookColor }]}>{p.outlook}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.reason} numberOfLines={2}>{p.reason}</Text>

      {/* The pre-built deal, from my perspective: what I send → what I get. */}
      <View style={styles.deal}>
        <View style={styles.side}>
          <Text style={styles.sideLabel}>YOU SEND</Text>
          <AssetChips assets={p.deal.send} />
          <Text style={styles.sideVal}>{(p.deal.sendValue || 0).toLocaleString()}</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
        <View style={styles.side}>
          <Text style={styles.sideLabel}>YOU GET</Text>
          <AssetChips assets={p.deal.receive} />
          <Value size={13}>{(p.deal.receiveValue || 0).toLocaleString()}</Value>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <Text style={[styles.verdict, { color: verdict.color }]}>{verdict.label}</Text>
        <Text style={styles.openHint}>Open deal ›</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4, paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  listHead: { color: colors.textDim, fontSize: 12, fontWeight: '700', marginTop: 8, marginBottom: 8, letterSpacing: 0.3 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  team: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 0.3, flex: 1, marginRight: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  chipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  reason: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
  deal: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  side: { flex: 1 },
  sideLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginBottom: 5 },
  sideVal: { color: colors.textDim, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 },
  arrow: { color: colors.textDim, fontSize: 18, fontWeight: '800', paddingHorizontal: 10 },
  assetWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  asset: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 6, maxWidth: '100%' },
  assetPick: { borderWidth: 1, borderColor: colors.goldDeep, backgroundColor: 'rgba(243,193,74,0.10)' },
  assetName: { color: colors.text, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  assetVal: { color: colors.textDim, fontSize: 11, fontWeight: '800', marginLeft: 6, fontVariant: ['tabular-nums'] },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  verdict: { fontSize: 12, fontWeight: '800' },
  openHint: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
