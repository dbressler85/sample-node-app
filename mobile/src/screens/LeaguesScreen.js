import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import useAndroidBack from '../useAndroidBack';

// The full list of your leagues, moved off the Home command center (which is now an
// action list). Doubles as the league switcher: PIN a league (★) to float it to the
// top of every cross-league view. The backend returns leagues pinned-first with the
// pinned flag.
export default function LeaguesScreen({ onBack, onOpenLeague, onOpenDraftHub }) {
  const [leagues, setLeagues] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState({}); // leagueId -> true while a toggle is in flight
  const [enrich, setEnrich] = useState({}); // leagueId -> { value, outlook, strengthPct, atRiskPct }

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  // The dynasty per-league data (value / outlook / risk) is a heavier read than the
  // bare league list, so fetch it in the BACKGROUND and merge it in when it lands —
  // the switcher paints names + pin instantly and the badges fill in a beat later.
  const loadEnrich = useCallback(() => {
    api.portfolio()
      .then((d) => {
        const map = {};
        for (const l of (d && d.byLeague) || []) {
          map[String(l.leagueId)] = { value: l.value, outlook: l.outlook, strengthPct: l.strengthPct, atRiskPct: l.atRiskPct };
        }
        setEnrich(map);
      })
      .catch(() => {}); // best-effort — names still work without it
  }, []);

  const load = useCallback(() => {
    api.leaguesList()
      .then((res) => setLeagues(res.leagues || []))
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
    loadEnrich();
  }, [loadEnrich]);
  useEffect(() => { load(); }, [load]);

  // Optimistically flip the pin, re-sort pinned-first, then reconcile with the server.
  const applyLocal = useCallback((leagueId, patch) => {
    setLeagues((prev) => {
      if (!prev) return prev;
      const next = prev.map((l) => (l.leagueId === leagueId ? { ...l, ...patch } : l));
      return next
        .map((l, i) => ({ l, i }))
        .sort((a, b) => (b.l.pinned ? 1 : 0) - (a.l.pinned ? 1 : 0) || a.i - b.i)
        .map((x) => x.l);
    });
  }, []);

  const togglePin = useCallback((item) => {
    if (busy[item.leagueId]) return;
    const on = !item.pinned;
    setBusy((b) => ({ ...b, [item.leagueId]: true }));
    applyLocal(item.leagueId, { pinned: on });
    api.setPin(item.leagueId, on)
      .catch(() => { setError('Could not update pin'); load(); })
      .finally(() => setBusy((b) => ({ ...b, [item.leagueId]: false })));
  }, [busy, applyLocal, load]);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
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
        renderItem={({ item }) => {
          const e = enrich[String(item.leagueId)];
          const sub = e ? [e.outlook, e.value != null ? `${e.value} value` : null].filter(Boolean).join(' · ') : null;
          const risk = e && e.atRiskPct > 0 ? e.atRiskPct : null;
          return (
            <View style={styles.row}>
              <Pressable style={styles.pinBtn} hitSlop={8} disabled={!!busy[item.leagueId]} onPress={() => togglePin(item)}>
                <Text style={[styles.pin, item.pinned && styles.pinOn]}>{item.pinned ? '★' : '☆'}</Text>
              </Pressable>
              <Pressable style={styles.nameWrap} onPress={() => onOpenLeague({ leagueId: item.leagueId, name: item.name })}>
                <View style={styles.nameLine}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                </View>
                {sub ? (
                  <Text style={styles.leagueSub} numberOfLines={1}>
                    {sub}
                    {risk != null ? <Text style={[styles.riskTag, risk >= 20 && { color: colors.bad }]}>{`  ·  ${risk}% risk`}</Text> : null}
                  </Text>
                ) : null}
              </Pressable>
              <Pressable hitSlop={8} onPress={() => onOpenLeague({ leagueId: item.leagueId, name: item.name })}>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            </View>
          );
        }}
        ListHeaderComponent={
          leagues && leagues.length ? (
            <Text style={styles.hint}>★ pin a league to the top of every cross-league view</Text>
          ) : null
        }
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
  container: { flex: 1, backgroundColor: 'transparent' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 70 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900' },
  link: { color: colors.accent, fontSize: 15, fontWeight: '700', width: 70, textAlign: 'right' },
  list: { padding: 16 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 12, lineHeight: 17 },
  center: { padding: 40, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: 12, marginBottom: 10 },
  pinBtn: { paddingRight: 10 },
  pin: { color: colors.textDim, fontSize: 20, fontWeight: '700' },
  pinOn: { color: colors.gold },
  nameWrap: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1, marginRight: 8 },
  leagueSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  riskTag: { color: colors.warn, fontWeight: '700' },
  chev: { color: colors.textDim, fontSize: 20, fontWeight: '700', paddingLeft: 4 },
  error: { color: colors.bad, textAlign: 'center', padding: 12 },
  empty: { color: colors.textDim, textAlign: 'center', padding: 30 },
});
