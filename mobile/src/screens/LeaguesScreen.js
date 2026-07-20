import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import useAndroidBack from '../useAndroidBack';

// The full list of your leagues, moved off the Home command center (which is now an
// action list). Intentionally light — one cheap /api/leagues call, names only — so
// it opens instantly; tap a league to open its roster (full dynasty detail there).
export default function LeaguesScreen({ onBack, onOpenLeague, onOpenDraftHub }) {
  const [leagues, setLeagues] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(() => {
    api.leaguesList()
      .then((res) => setLeagues(res.leagues || []))
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Home</Text></Pressable>
        <Text style={styles.title}>Your Leagues</Text>
        <Pressable onPress={onOpenDraftHub} hitSlop={10}><Text style={styles.link}>Drafts ›</Text></Pressable>
      </View>

      {error ? (
        <Pressable onPress={() => { setError(null); load(); }}><Text style={styles.error}>{error} · tap to retry</Text></Pressable>
      ) : null}

      <FlatList
        data={leagues || []}
        keyExtractor={(l) => l.leagueId}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={() => onOpenLeague({ leagueId: item.leagueId, name: item.name })}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          leagues == null ? (
            <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
          ) : (
            <Text style={styles.empty}>No leagues found for this account.</Text>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 70 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900' },
  link: { color: colors.accent, fontSize: 15, fontWeight: '700', width: 70, textAlign: 'right' },
  list: { padding: 16 },
  center: { padding: 40, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 10 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 10 },
  chev: { color: colors.textDim, fontSize: 20, fontWeight: '700' },
  error: { color: colors.bad, textAlign: 'center', padding: 12 },
  empty: { color: colors.textDim, textAlign: 'center', padding: 30 },
});
