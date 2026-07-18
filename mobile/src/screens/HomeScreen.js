import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';

const SEV = {
  high: { color: colors.bad, dot: colors.bad },
  medium: { color: colors.warn, dot: colors.warn },
  low: { color: colors.textDim, dot: colors.accent },
};

const ACTION_LABEL = { lineup: 'Set lineup ›', trade: 'View trade ›', waiver: 'View ›' };

export default function HomeScreen({ onOpenLineup, onOpenLeague, onLogout }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.home());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleAction(item) {
    const league = { leagueId: item.leagueId, name: item.leagueName };
    if (item.action === 'lineup') onOpenLineup(league);
    else onOpenLeague(league);
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const p = data && data.portfolio;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <View>
          <Text style={styles.title}>Command Center</Text>
          {data ? <Text style={styles.subtitle}>Week {data.week}</Text> : null}
        </View>
        <Pressable onPress={onLogout} hitSlop={10}>
          <Text style={styles.logout}>Log out</Text>
        </Pressable>
      </View>

      <FlatList
        data={data ? data.triage : []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <View>
            {p ? <Portfolio p={p} /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.section}>
              Needs attention {data && data.triage.length ? `· ${data.triage.length}` : ''}
            </Text>
          </View>
        }
        renderItem={({ item }) => <TriageRow item={item} onPress={() => handleAction(item)} />}
        ListEmptyComponent={<Text style={styles.clear}>🎉 Nothing needs you right now.</Text>}
      />
    </View>
  );
}

function Portfolio({ p }) {
  return (
    <View style={styles.portfolio}>
      <View style={styles.tileRow}>
        <Tile label="This week" value={p.weekRecord} hint={`${p.leagues} leagues`} big />
        <Tile label="Action items" value={String(p.actionItems)} hint="to-dos" big accent={p.actionItems > 0} />
      </View>
      <View style={styles.chips}>
        <Chip label="Lineups" value={p.lineupsNeedAttention} bad={p.risky > 0} />
        <Chip label="Close games" value={p.closeGames} />
        <Chip label="Trades" value={p.tradeOffers} bad={p.tradeOffers > 0} />
        <Chip label="Waivers" value={p.waiversPending} />
        {p.pointsAvailable > 0 ? <Chip label="Pts left" value={`+${p.pointsAvailable}`} warn /> : null}
      </View>
    </View>
  );
}

function Tile({ label, value, hint, big, accent }) {
  return (
    <View style={[styles.tile, big && { flex: 1 }]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, accent && { color: colors.accent }]}>{value}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

function Chip({ label, value, bad, warn }) {
  const c = bad ? colors.bad : warn ? colors.warn : colors.textDim;
  return (
    <View style={styles.chip}>
      <Text style={[styles.chipValue, { color: c }]}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

function TriageRow({ item, onPress }) {
  const s = SEV[item.severity] || SEV.low;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={[styles.sevDot, { backgroundColor: s.dot }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={2}>
          {item.subtitle}
        </Text>
        <Text style={styles.rowLeague}>{item.leagueName}</Text>
      </View>
      <Text style={[styles.rowAction, { color: s.color }]}>{ACTION_LABEL[item.action] || '›'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  logout: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  portfolio: { marginBottom: 8 },
  tileRow: { flexDirection: 'row', gap: 12 },
  tile: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 },
  tileLabel: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  tileValue: { color: colors.text, fontSize: 30, fontWeight: '900', marginTop: 4 },
  tileHint: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 72 },
  chipValue: { fontSize: 18, fontWeight: '900' },
  chipLabel: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginTop: 2 },
  section: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 20, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  sevDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  rowLeague: { color: colors.accent, fontSize: 12, fontWeight: '600', marginTop: 4 },
  rowAction: { fontSize: 13, fontWeight: '700', marginLeft: 10 },
  error: { color: colors.bad, marginVertical: 8 },
  clear: { color: colors.textDim, textAlign: 'center', marginTop: 30, fontSize: 15 },
});
