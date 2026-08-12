import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { colors } from '../theme';
import { displayLabel } from '../typography';
import { api } from '../api';
import ErrorView from '../components/ErrorView';
import EmptyView from '../components/EmptyView';
import PressableScale from '../components/PressableScale';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';
import { STALE } from '../staleTiers';
import { Value, TopbarTitle } from '../components/Brand';

// The single-league trade FINDER: the fairest, roster-fitting deals available across every partner in
// THIS league right now, ranked by your window (a contender tolerates paying up for a win-now fit). Each
// row is a pre-built, value-balanced deal — tap it to open the trade desk seeded on that exact deal.

// My-perspective value verdict → tint. Shares the trade desk's wording for the shared cases
// ("You gain value" / "Fair deal"); 'light' = I pay a small premium for a target (a caution in this
// shopping context, distinct from the desk's "you give up value"). Keyed off the backend's values
// (favorable / fair / light) — kept identical to PickTradeFinder so the two finders can't drift (#24).
const VERDICT = {
  favorable: { color: colors.good, label: 'You gain value' },
  fair: { color: colors.textDim, label: 'Fair deal' },
  light: { color: colors.warn, label: 'You pay up' },
};
// The window drives what "a good deal" even means — surface it so the ranking reads as intentional.
const OUTLOOK_COLOR = {
  'Win-now window': colors.warn,
  Ascending: colors.good,
  Rebuilding: colors.textDim,
  Balanced: colors.textDim,
};

export default function TradeFinderScreen({ league, onBack, onOpenDeal }) {
  const leagueId = league.leagueId;
  // Deals move on roster/bait changes (write-invalidated); an hourly passive re-check suffices.
  const { data, error, refreshing, loading, reload } = useCachedResource(
    `tradeFinder:${leagueId}`,
    () => api.findDeals(leagueId),
    { staleMs: STALE.SLOW },
  );
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const deals = (data && data.deals) || [];
  const outlookColor = OUTLOOK_COLOR[data && data.myOutlook] || colors.textDim;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.back} numberOfLines={1}>‹ Back</Text>
        </Pressable>
        <TopbarTitle numberOfLines={1}>Find Deals</TopbarTitle>
        <View style={{ width: 60 }} />
      </View>
      <Text style={styles.subtitle} numberOfLines={1}>
        {(data && data.name) || league.name} · fairest deals available now
      </Text>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : !deals.length ? (
        <EmptyView title="No fair deals right now" message="No partner in this league lines up for a roster-fitting, value-balanced deal at the moment. Pull to refresh after the next roster move." />
      ) : (
        <FlatList
          data={deals}
          keyExtractor={(d) => d.partnerFranchiseId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          renderItem={({ item }) => <DealCard d={item} onOpenDeal={onOpenDeal} />}
          ListHeaderComponent={
            <View style={styles.head}>
              <Text style={styles.listHead}>Best-fit deals · ranked for your window</Text>
              {data && data.myOutlook ? (
                <View style={[styles.chip, { borderColor: outlookColor }]}>
                  <View style={[styles.dot, { backgroundColor: outlookColor }]} />
                  <Text style={[styles.chipText, { color: outlookColor }]}>{data.myOutlook}</Text>
                </View>
              ) : null}
            </View>
          }
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

function DealCard({ d, onOpenDeal }) {
  const verdict = VERDICT[d.verdict] || VERDICT.fair;
  const open = () =>
    onOpenDeal({
      partnerFranchiseId: d.partnerFranchiseId,
      sendTokens: d.send.map((a) => a.id),
      receiveTokens: d.receive.map((a) => a.id),
    });
  return (
    <PressableScale style={styles.card} onPress={open}>
      <View style={styles.cardTop}>
        <Text style={[styles.team, displayLabel()]} numberOfLines={1}>{d.partnerName || 'Their team'}</Text>
        {d.fillsNeed ? <Text style={styles.needTag}>fills your need</Text> : null}
      </View>
      {d.rationale ? <Text style={styles.reason} numberOfLines={2}>{d.rationale}</Text> : null}

      {/* The pre-built deal, from my perspective: what I send → what I get. */}
      <View style={styles.deal}>
        <View style={styles.side}>
          <Text style={styles.sideLabel}>YOU SEND</Text>
          <AssetChips assets={d.send} />
          <Text style={styles.sideVal}>{(d.sendValue || 0).toLocaleString()}</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
        <View style={styles.side}>
          <Text style={styles.sideLabel}>YOU GET</Text>
          <AssetChips assets={d.receive} />
          <Value size={13}>{(d.receiveValue || 0).toLocaleString()}</Value>
        </View>
      </View>

      <View style={styles.cardFoot}>
        <Text style={[styles.verdict, { color: verdict.color }]}>{verdict.label}</Text>
        {d.fairness != null ? <Text style={styles.fairness}>{d.fairness}% even</Text> : null}
        <Text style={styles.openHint}>Open deal ›</Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { minWidth: 60, minHeight: 44, justifyContent: 'center' },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4, paddingHorizontal: 16 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  listHead: { color: colors.violetText, fontSize: 12, fontWeight: '700', letterSpacing: 0.3, flexShrink: 1, marginRight: 8 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  team: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 0.3, flex: 1, marginRight: 10 },
  needTag: { color: colors.good, fontSize: 10, fontWeight: '800', letterSpacing: 0.2, borderWidth: 1, borderColor: colors.good, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  chipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },
  reason: { color: colors.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
  deal: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  side: { flex: 1 },
  sideLabel: { color: colors.violetText, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginBottom: 5 },
  sideVal: { color: colors.textDim, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 },
  arrow: { color: colors.textDim, fontSize: 18, fontWeight: '800', paddingHorizontal: 10 },
  assetWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  asset: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginBottom: 6, maxWidth: '100%' },
  assetPick: { borderWidth: 1, borderColor: colors.goldDeep, backgroundColor: 'rgba(243,193,74,0.10)' },
  assetName: { color: colors.text, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  assetVal: { color: colors.textDim, fontSize: 11, fontWeight: '800', marginLeft: 6, fontVariant: ['tabular-nums'] },
  cardFoot: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 12 },
  verdict: { fontSize: 12, fontWeight: '800' },
  fairness: { color: colors.textDim, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  openHint: { color: colors.accent, fontSize: 13, fontWeight: '700', marginLeft: 'auto' },
});
