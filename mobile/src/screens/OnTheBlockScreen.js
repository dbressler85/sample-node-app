import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import useAndroidBack from '../useAndroidBack';

// Centralized trade bait: every player you're shopping, grouped by league, with value /
// slot / note and a jump to that league's trade desk to actually build the offer. Add
// players to the block from a roster (the ⇄ Block toggle on each player).
export default function OnTheBlockScreen({ onBack, onShopLeague }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // `${leagueId}:${playerId}` being removed

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.tradeBait());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function removeOne(leagueId, player) {
    const k = `${leagueId}:${player.id}`;
    setBusy(k);
    try {
      await api.removeBait(leagueId, player.id);
      await load();
    } catch (e) {
      Alert.alert('Could not remove', e.message);
    } finally {
      setBusy(null);
    }
  }

  const totals = data && data.totals;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Trades</Text>
        </Pressable>
        <Text style={styles.title}>On the Block</Text>
        <View style={{ width: 60 }} />
      </View>
      {totals && totals.count > 0 ? (
        <Text style={styles.subtitle}>
          {totals.count} player{totals.count === 1 ? '' : 's'} shopped across {totals.leagues} league{totals.leagues === 1 ? '' : 's'}
          <Text style={{ color: colors.gold, fontWeight: '800' }}>{`  ·  ${totals.value} value`}</Text>
        </Text>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : (
        <FlatList
          data={(data && data.leagues) || []}
          keyExtractor={(l) => l.leagueId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
          renderItem={({ item: lg }) => (
            <View style={styles.card}>
              <Pressable style={({ pressed }) => [styles.leagueRow, pressed && { opacity: 0.7 }]} onPress={() => onShopLeague({ leagueId: lg.leagueId, name: lg.name })}>
                <Text style={styles.leagueName} numberOfLines={1}>{lg.name}</Text>
                <Text style={styles.shopLink}>Shop ›</Text>
              </Pressable>
              {lg.players.map((p) => (
                <View key={p.id} style={styles.playerRow}>
                  <View style={[styles.dot, { backgroundColor: positionColors[p.position] || colors.textDim }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.playerName} numberOfLines={1}>
                      {p.name}
                      {p.stale ? <Text style={styles.stale}>  · no longer rostered</Text> : null}
                    </Text>
                    <Text style={styles.playerMeta} numberOfLines={1}>
                      {[p.position, p.bucket, p.age != null ? `${p.age}y` : null].filter(Boolean).join(' · ')}
                      {p.note ? <Text style={styles.note}>{`  ·  “${p.note}”`}</Text> : null}
                    </Text>
                  </View>
                  {p.value != null ? <Text style={styles.playerVal}>{p.value}</Text> : null}
                  <Pressable onPress={() => removeOne(lg.leagueId, p)} hitSlop={8} style={styles.remove} disabled={busy === `${lg.leagueId}:${p.id}`}>
                    {busy === `${lg.leagueId}:${p.id}` ? <ActivityIndicator size="small" color={colors.textDim} /> : <Text style={styles.removeTxt}>✕</Text>}
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Nobody on the block</Text>
              <Text style={styles.emptyText}>Open any league's roster and tap ⇄ Block on a player to start shopping him. They'll all show up here.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  leagueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, marginBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  leagueName: { color: colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.3, flex: 1, marginRight: 10, textTransform: 'uppercase' },
  shopLink: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  playerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  playerName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  stale: { color: colors.warn, fontSize: 12, fontWeight: '700' },
  playerMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  note: { color: colors.textDim, fontStyle: 'italic' },
  playerVal: { color: colors.gold, fontSize: 15, fontWeight: '900', marginRight: 12, minWidth: 30, textAlign: 'right' },
  remove: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  removeTxt: { color: colors.textDim, fontSize: 16, fontWeight: '800' },
  error: { color: colors.bad, textAlign: 'center' },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
});
