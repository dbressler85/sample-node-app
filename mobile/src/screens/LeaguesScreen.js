import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { api, bg } from '../api';
import { colors } from '../theme';
import { TopbarTitle } from '../components/Brand';
import Reveal from '../components/Reveal';
import EmptyView from '../components/EmptyView';
import useAndroidBack from '../useAndroidBack';
import { peekResource, primeResource } from '../useCachedResource';
import { setValue } from '../cache';
import { standingsPreferDevice, leagueTeamsPreferDevice } from '../mflDevice';

// Compact countdown for a trade deadline ({ at: ms }) → { label, urgent }, or null when none/past.
function deadlineChip(dl) {
  if (!dl || !dl.at || dl.at <= Date.now()) return null;
  const days = Math.ceil((dl.at - Date.now()) / 86400000);
  return { label: days <= 0 ? 'trade: today' : days === 1 ? 'trade: tomorrow' : `trade: ${days}d`, urgent: days <= 7 };
}

// The full list of your leagues, moved off the Home command center (which is now an
// action list). Doubles as the league switcher: PIN a league (★) to float it to the
// top of every cross-league view. The backend returns leagues pinned-first with the
// pinned flag.
export default function LeaguesScreen({ onBack, onOpenLeague, onOpenDraftHub }) {
  // Seed from the surviving in-memory store so re-opening the switcher (an overlay — unmounts on back)
  // repaints the league list instantly instead of cold-loading a full spinner each time.
  const [leagues, setLeagues] = useState(() => { const h = peekResource('leagues:list'); return h ? h.value : null; });
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState({}); // leagueId -> true while a toggle is in flight
  const [enrich, setEnrich] = useState({}); // leagueId -> { value, outlook, strengthPct, atRiskPct }
  const [query, setQuery] = useState(''); // name filter across ~15 leagues (usability backlog #9)

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  // The dynasty per-league data (value / outlook / risk) is a heavier read than the
  // bare league list, so fetch it in the BACKGROUND and merge it in when it lands —
  // the switcher paints names + pin instantly and the badges fill in a beat later.
  const loadEnrich = useCallback(() => {
    // Background/LOW priority: this per-league badge fan-out is ~15 leagues and must NOT head-of-line-
    // block the foreground read the user is about to trigger by opening a league (both share the
    // account's FIFO NORMAL lane). Badges merge in a beat later regardless.
    bg(() => api.portfolio())
      .then((d) => {
        const map = {};
        for (const l of (d && d.byLeague) || []) {
          map[String(l.leagueId)] = { value: l.value, outlook: l.outlook, strengthPct: l.strengthPct, strengthLabel: l.strengthLabel, atRiskPct: l.atRiskPct, tradeDeadline: l.tradeDeadline };
        }
        setEnrich(map);
      })
      .catch(() => {}); // best-effort — names still work without it
  }, []);

  const load = useCallback(() => {
    api.leaguesList()
      .then((res) => { const list = res.leagues || []; setLeagues(list); primeResource('leagues:list', list); })
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
    loadEnrich();
  }, [loadEnrich]);
  useEffect(() => { load(); }, [load]);

  // Prefetch a league's hub the instant its row is pressed, priming the EXACT keys LeagueScreen's tabs
  // read (`league:standings:<id>` = the default tab, `league:teams:<id>` = the likely-next Rosters tab).
  // The ~250ms nav animation overlaps the fetch, so LeagueScreen usually mounts to a warm cache hit and
  // paints instantly instead of a cold read behind a skeleton. These reads ARE the foreground reads the
  // user wants now, so they run at NORMAL priority (not bg). Guarded so a re-tap doesn't refire.
  const openLeague = useCallback((item) => {
    const id = String(item.leagueId);
    if (!peekResource(`league:standings:${id}`)) {
      standingsPreferDevice(id).then((d) => { primeResource(`league:standings:${id}`, d); setValue(`league:standings:${id}`, d); }).catch(() => {});
    }
    if (!peekResource(`league:teams:${id}`)) {
      leagueTeamsPreferDevice(id).then((d) => { primeResource(`league:teams:${id}`, d); setValue(`league:teams:${id}`, d); }).catch(() => {});
    }
    onOpenLeague({ leagueId: item.leagueId, name: item.name });
  }, [onOpenLeague]);

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

  // Name filter (local, over the already-loaded list). Only worth showing once the list is long enough
  // to scroll; below that a search box is just clutter.
  const q = query.trim().toLowerCase();
  const shown = q ? (leagues || []).filter((l) => String(l.name).toLowerCase().includes(q)) : (leagues || []);
  const showSearch = !!(leagues && leagues.length > 6);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
        <TopbarTitle>Your Leagues</TopbarTitle>
        <Pressable onPress={onOpenDraftHub} hitSlop={10}><Text style={styles.link}>Drafts ›</Text></Pressable>
      </View>

      {showSearch ? (
        <View style={styles.searchRow}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search leagues"
            placeholderTextColor={colors.textDim}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="Search your leagues by name"
          />
          {query.length ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel="Clear search">
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Pressable onPress={() => { setError(null); load(); }}><Text style={styles.error}>{error} · tap to retry</Text></Pressable>
      ) : null}

      <FlatList
        data={shown}
        keyExtractor={(l) => l.leagueId}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        renderItem={({ item, index }) => {
          const e = enrich[String(item.leagueId)];
          const outlookText = e && e.outlook ? e.outlook : null;
          const valueText = e && e.value != null ? `${e.value} value` : null;
          const sub = outlookText || valueText;
          const risk = e && e.atRiskPct > 0 ? e.atRiskPct : null;
          const dl = e ? deadlineChip(e.tradeDeadline) : null;
          return (
            <Reveal delay={Math.min(index, 10) * 40} animate={index < 12}>
            <View style={styles.row}>
              <Pressable
                style={styles.pinBtn}
                hitSlop={8}
                disabled={!!busy[item.leagueId]}
                onPress={() => togglePin(item)}
                accessibilityRole="button"
                accessibilityState={{ selected: item.pinned }}
                accessibilityLabel={item.pinned ? `Unpin ${item.name}` : `Pin ${item.name} to the top`}
              >
                <Text style={[styles.pin, item.pinned && styles.pinOn]}>{item.pinned ? '★' : '☆'}</Text>
              </Pressable>
              <Pressable style={styles.nameWrap} onPress={() => openLeague(item)}>
                <View style={styles.nameLine}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  {dl ? <Text style={[styles.dlChip, dl.urgent && styles.dlChipUrgent]}>{dl.label}</Text> : null}
                </View>
                {sub ? (
                  <Text style={styles.leagueSub} numberOfLines={1}>
                    {outlookText}
                    {outlookText && valueText ? ' · ' : null}
                    {valueText ? <Text style={{ color: colors.gold }}>{valueText}</Text> : null}
                    {risk != null ? <Text style={[styles.riskTag, risk >= 20 && { color: colors.bad }]}>{`  ·  ${risk}% risk`}</Text> : null}
                  </Text>
                ) : null}
              </Pressable>
              <Pressable hitSlop={8} onPress={() => openLeague(item)}>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            </View>
            </Reveal>
          );
        }}
        ListHeaderComponent={
          !q && leagues && leagues.length ? (
            <Text style={styles.hint}>★ pin a league to the top of every cross-league view</Text>
          ) : null
        }
        ListEmptyComponent={
          leagues == null ? (
            <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
          ) : q ? (
            <EmptyView title={`No leagues match “${query.trim()}”`} message="Try a different name, or clear the search." />
          ) : (
            <EmptyView title="No leagues found" message="We couldn’t find any leagues on this MFL account. Pull down to refresh." />
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
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 4, marginBottom: 2 },
  search: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: colors.text, fontSize: 14 },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  clearText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: 12, lineHeight: 17 },
  center: { padding: 40, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: 12, marginBottom: 10 },
  pinBtn: { paddingRight: 10 },
  pin: { color: colors.textDim, fontSize: 20, fontWeight: '700' },
  pinOn: { color: colors.accent },
  nameWrap: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1, marginRight: 8 },
  leagueSub: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  riskTag: { color: colors.warn, fontWeight: '700' },
  dlChip: { color: colors.textDim, backgroundColor: colors.cardAlt, fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, overflow: 'hidden' },
  dlChipUrgent: { color: colors.onAccent, backgroundColor: colors.warn },
  chev: { color: colors.textDim, fontSize: 20, fontWeight: '700', paddingLeft: 4 },
  error: { color: colors.bad, textAlign: 'center', padding: 12 },
  empty: { color: colors.textDim, textAlign: 'center', padding: 30 },
});
