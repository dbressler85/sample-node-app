import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { api } from '../api';
import { colors } from '../theme';

const STATUS = {
  optimal: { label: 'Optimal', color: colors.good },
  suboptimal: { label: 'Points available', color: colors.warn },
  incomplete: { label: 'Empty slot', color: colors.bad },
};

export default function LineupsScreen({ onOpenLineup }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.lineups());
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

  function confirmSetAll() {
    const s = data && data.summary;
    if (!s || s.needAttention === 0) {
      Alert.alert('All set', 'Every lineup is already optimal. Nothing to change.');
      return;
    }
    Alert.alert(
      'Set all lineups?',
      `Optimize ${s.needAttention} league${s.needAttention === 1 ? '' : 's'} for +${s.pointsAvailable} projected points.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Set all', style: 'default', onPress: setAll },
      ]
    );
  }

  async function setAll() {
    setApplying(true);
    try {
      const res = await api.applyAllLineups();
      await load();
      Alert.alert(
        'Lineups set',
        `${res.summary.leaguesUpdated} league${res.summary.leaguesUpdated === 1 ? '' : 's'} updated · +${res.summary.pointsGained} projected points.`
      );
    } catch (e) {
      Alert.alert('Could not set lineups', e.message);
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const summary = data && data.summary;
  const canSetAll = summary && summary.needAttention > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Lineups</Text>
        {summary ? (
          <Text style={styles.subtitle}>
            {summary.needAttention === 0
              ? `All ${summary.total} lineups optimal · Week ${data.week}`
              : `${summary.needAttention} of ${summary.total} need attention · +${summary.pointsAvailable} pts available`}
          </Text>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.setAll,
          !canSetAll && styles.setAllDisabled,
          pressed && canSetAll && { opacity: 0.85 },
        ]}
        onPress={confirmSetAll}
        disabled={applying}
      >
        {applying ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.setAllText}>
            {canSetAll ? `Set All Lineups  ·  +${summary.pointsAvailable}` : 'All Lineups Optimal'}
          </Text>
        )}
      </Pressable>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={data ? data.leagues : []}
          keyExtractor={(l) => l.leagueId}
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
          renderItem={({ item }) => <Row item={item} onPress={() => onOpenLineup(item)} />}
        />
      )}
    </View>
  );
}

function Row({ item, onPress }) {
  if (item.error) {
    return (
      <View style={styles.row}>
        <Text style={styles.league}>{item.name}</Text>
        <Text style={styles.rowError}>{item.error}</Text>
      </View>
    );
  }
  const s = STATUS[item.status] || STATUS.optimal;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={styles.rowTop}>
        <Text style={styles.league} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={[styles.badge, { borderColor: s.color }]}>
          <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
        </View>
      </View>
      <View style={styles.rowBottom}>
        <Text style={styles.pts}>
          <Text style={styles.ptsStrong}>{item.currentTotal}</Text>
          <Text style={styles.ptsDim}> / {item.optimalTotal} opt</Text>
        </Text>
        {item.delta > 0 ? <Text style={[styles.delta, { color: s.color }]}>+{item.delta}</Text> : (
          <Text style={styles.chev}>›</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  setAll: {
    backgroundColor: colors.accent,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  setAllDisabled: { backgroundColor: colors.cardAlt },
  setAllText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  league: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 10 },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  pts: { fontSize: 15 },
  ptsStrong: { color: colors.text, fontWeight: '800' },
  ptsDim: { color: colors.textDim },
  delta: { fontSize: 18, fontWeight: '900' },
  chev: { color: colors.textDim, fontSize: 22, fontWeight: '700' },
  rowError: { color: colors.bad, marginTop: 6, fontSize: 13 },
  error: { color: colors.bad, textAlign: 'center' },
});
