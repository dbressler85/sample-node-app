import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';

export default function PlayersScreen() {
  const [view, setView] = useState('exposure'); // 'exposure' | 'news'
  const [exposure, setExposure] = useState(null);
  const [news, setNews] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [e, n] = await Promise.all([api.exposure(), api.news()]);
      setExposure(e);
      setNews(n);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Players</Text>
        {exposure ? (
          <Text style={styles.subtitle}>
            {exposure.summary.uniquePlayers} rostered · {exposure.summary.multiLeague} in multiple leagues
          </Text>
        ) : null}
      </View>

      <View style={styles.segment}>
        <Seg label="Exposure" active={view === 'exposure'} onPress={() => setView('exposure')} />
        <Seg label={`News${news && news.news.length ? ` (${news.news.length})` : ''}`} active={view === 'news'} onPress={() => setView('news')} />
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : view === 'exposure' ? (
        <FlatList
          data={exposure ? exposure.players : []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          renderItem={({ item }) => <ExposureRow p={item} />}
        />
      ) : (
        <FlatList
          data={news ? news.news : []}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          renderItem={({ item }) => <NewsRow n={item} />}
          ListEmptyComponent={<Text style={styles.empty}>No news right now.</Text>}
        />
      )}
    </View>
  );
}

function Seg({ label, active, onPress }) {
  return (
    <Pressable style={[styles.seg, active && styles.segActive]} onPress={onPress}>
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ExposureRow({ p }) {
  const posColor = positionColors[p.position] || colors.textDim;
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={[styles.posDot, { backgroundColor: posColor }]} />
        <Text style={styles.name} numberOfLines={1}>
          {p.name}
        </Text>
        <AvailabilityBadge availability={p.availability} style={{ marginLeft: 6 }} />
        <View style={{ flex: 1 }} />
        {p.value != null ? <Text style={styles.value}>{p.value}</Text> : null}
      </View>
      <Text style={styles.meta}>
        {p.position} · {p.team}
        {p.age != null ? ` · age ${p.age}` : ''} · {p.count} league{p.count === 1 ? '' : 's'} ({p.startingCount} starting) · {p.exposurePct}% exposure
      </Text>
      <View style={styles.leagueChips}>
        {p.leagues.map((l) => (
          <View key={l.leagueId} style={styles.leagueChip}>
            <View style={[styles.startDot, { backgroundColor: l.starting ? colors.good : colors.border }]} />
            <Text style={styles.leagueChipText} numberOfLines={1}>
              {l.name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function NewsRow({ n }) {
  const sev = n.severity === 'high' ? colors.bad : n.severity === 'medium' ? colors.warn : colors.textDim;
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={[styles.sevDot, { backgroundColor: sev }]} />
        <Text style={styles.newsHead} numberOfLines={2}>
          {n.headline}
        </Text>
      </View>
      {n.affectedCount > 0 ? (
        <Text style={styles.affects}>
          Affects {n.affectedCount} of your team{n.affectedCount === 1 ? '' : 's'}
          {n.startingCount > 0 ? ` · starting in ${n.startingCount}` : ''}
        </Text>
      ) : (
        <Text style={styles.affectsDim}>Not on any of your rosters</Text>
      )}
      <View style={styles.leagueChips}>
        {n.affectedLeagues.map((l) => (
          <View key={l.leagueId} style={styles.leagueChip}>
            <View style={[styles.startDot, { backgroundColor: l.starting ? colors.good : colors.border }]} />
            <Text style={styles.leagueChipText} numberOfLines={1}>
              {l.name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  segment: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, marginBottom: 6 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: colors.text },
  list: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 6 },
  row: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  posDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  value: { color: colors.accent, fontSize: 15, fontWeight: '900' },
  meta: { color: colors.textDim, fontSize: 12, marginTop: 6 },
  leagueChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  leagueChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  startDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  leagueChipText: { color: colors.textDim, fontSize: 11, fontWeight: '600', maxWidth: 120 },
  sevDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  newsHead: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  affects: { color: colors.text, fontSize: 13, marginTop: 8, fontWeight: '600' },
  affectsDim: { color: colors.textDim, fontSize: 13, marginTop: 8 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 30 },
  error: { color: colors.bad, textAlign: 'center' },
});
