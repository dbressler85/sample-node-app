import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, SectionList, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import ErrorView from '../components/ErrorView';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';
import { Value } from '../components/Brand';

// Your draft-pick capital across every league in one place: current-year picks (still in the
// draft grid) and future-season picks, value-tagged and grouped by year. Read-only — a
// scouting view of what you hold; trading picks stays on the trade desk.

// A round → tint, so a 1st reads hotter than a 4th at a glance.
const ROUND_COLOR = { 1: colors.gold, 2: colors.accent, 3: colors.good, 4: colors.textDim };

export default function PickInventoryScreen({ onBack }) {
  const { data, error, refreshing, loading, reload } = useCachedResource('pickInventory', () => api.pickInventory());
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const summary = data && data.summary;
  const sections = ((data && data.byYear) || []).map((y) => ({
    title: y.year ? String(y.year) : 'Undated',
    value: y.value,
    data: y.picks,
  }));

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
        <Text style={styles.title}>Pick Capital</Text>
        <View style={{ width: 54 }} />
      </View>
      {summary ? (
        <Text style={styles.subtitle}>
          {summary.total} pick{summary.total === 1 ? '' : 's'} · {summary.firsts} first{summary.firsts === 1 ? '' : 's'}
          {summary.acquired ? ` · ${summary.acquired} acquired` : ''} · {summary.totalValue.toLocaleString()} value
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : !sections.length ? (
        <View style={styles.center}><Text style={styles.emptyText}>No draft picks found across your leagues.</Text></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, i) => `${item.leagueId}:${item.token}:${i}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionRow}>
              <Text style={styles.section}>{section.title}</Text>
              <Text style={styles.sectionVal}>{section.value.toLocaleString()} value</Text>
            </View>
          )}
          renderItem={({ item }) => <PickRow p={item} />}
        />
      )}
    </View>
  );
}

function PickRow({ p }) {
  const rc = ROUND_COLOR[p.round] || colors.textDim;
  return (
    <View style={[styles.row, { borderLeftColor: rc, borderLeftWidth: 3 }]}>
      <View style={[styles.roundBadge, { backgroundColor: rc + '22', borderColor: rc }]}>
        <Text style={[styles.roundText, { color: rc }]}>{p.round ? `R${p.round}` : '—'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.pickLabel} numberOfLines={1}>
          {p.label}
          {p.kind === 'upcoming' ? <Text style={styles.tag}>  THIS YEAR</Text> : null}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {p.leagueName}
          {p.acquiredFrom ? ` · from ${p.acquiredFrom}` : ''}
        </Text>
      </View>
      {p.value != null ? <Value size={15}>{p.value}</Value> : null}
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
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  section: { color: colors.text, fontSize: 15, fontWeight: '900', letterSpacing: 0.4 },
  sectionVal: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  roundBadge: { width: 38, paddingVertical: 3, borderRadius: 6, borderWidth: 1, alignItems: 'center', marginRight: 10 },
  roundText: { fontSize: 11, fontWeight: '800' },
  pickLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  tag: { color: colors.gold, fontSize: 10, fontWeight: '900' },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center' },
});
