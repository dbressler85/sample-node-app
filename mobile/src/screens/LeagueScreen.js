import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { api } from '../api';
import { colors, positionColors } from '../theme';
import ErrorView from '../components/ErrorView';
import useAndroidBack from '../useAndroidBack';

// The league hub: the ordinary league views the app was missing — Standings,
// Rosters (browse every team = opponent scouting), and a Transactions feed. Reached
// by tapping a league in the Leagues list.
const TABS = [
  ['standings', 'Standings'],
  ['rosters', 'Rosters'],
  ['txns', 'Transactions'],
];

export default function LeagueScreen({ league, onBack, onOpenPlayer }) {
  const [tab, setTab] = useState('standings');
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Leagues</Text></Pressable>
        <Text style={styles.title} numberOfLines={1}>{league.name}</Text>
        <View style={{ width: 66 }} />
      </View>

      <View style={styles.segment}>
        {TABS.map(([k, label]) => (
          <Pressable key={k} style={[styles.seg, tab === k && styles.segActive]} onPress={() => setTab(k)}>
            <Text style={[styles.segText, tab === k && styles.segTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'standings' ? <StandingsTab leagueId={league.leagueId} /> : null}
      {tab === 'rosters' ? <RostersTab leagueId={league.leagueId} onOpenPlayer={onOpenPlayer} /> : null}
      {tab === 'txns' ? <TransactionsTab leagueId={league.leagueId} onOpenPlayer={onOpenPlayer} /> : null}
    </View>
  );
}

// --- data hook: load once per tab, with pull-to-refresh -----------------------
function useTab(fetcher) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async (isRefresh) => {
    setError(null);
    if (isRefresh) setRefreshing(true);
    try {
      setData(await fetcher());
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [fetcher]);
  useEffect(() => { load(false); }, [load]);
  return { data, error, refreshing, reload: () => load(true) };
}

// --- Standings ----------------------------------------------------------------
function StandingsTab({ leagueId }) {
  const { data, error, refreshing, reload } = useTab(useCallback(() => api.leagueStandings(leagueId), [leagueId]));
  if (error && !data) return <ErrorView message={error} onRetry={reload} onRefresh={reload} refreshing={refreshing} />;
  if (!data) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;

  return (
    <FlatList
      data={data.standings}
      keyExtractor={(t) => t.franchiseId}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
      ListHeaderComponent={
        <View style={styles.stHead}>
          <Text style={[styles.stRank, styles.stHeadText]}>#</Text>
          <Text style={[styles.stTeam, styles.stHeadText]}>Team</Text>
          <Text style={[styles.stRec, styles.stHeadText]}>W-L</Text>
          <Text style={[styles.stPf, styles.stHeadText]}>PF</Text>
        </View>
      }
      renderItem={({ item }) => (
        <>
          <View style={[styles.stRow, item.mine && styles.stMine]}>
            <Text style={[styles.stRank, item.inPlayoffs && styles.stIn]}>{item.rank}</Text>
            <Text style={[styles.stTeam, item.mine && styles.stTeamMine]} numberOfLines={1}>{item.name}{item.mine ? '  ·  you' : ''}</Text>
            <Text style={styles.stRec}>{item.record}</Text>
            <Text style={styles.stPf}>{item.pointsFor}</Text>
          </View>
          {data.playoffSpots && item.rank === data.playoffSpots ? (
            <View style={styles.playoffLine}><Text style={styles.playoffText}>PLAYOFF LINE</Text></View>
          ) : null}
        </>
      )}
    />
  );
}

// --- Rosters (opponent scouting) ----------------------------------------------
function RostersTab({ leagueId, onOpenPlayer }) {
  const { data, error, refreshing, reload } = useTab(useCallback(() => api.leagueTeams(leagueId), [leagueId]));
  const [sel, setSel] = useState(null);
  if (error && !data) return <ErrorView message={error} onRetry={reload} onRefresh={reload} refreshing={refreshing} />;
  if (!data) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;

  const teams = data.teams || [];
  const active = teams.find((t) => t.franchiseId === sel) || teams.find((t) => t.mine) || teams[0];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {teams.map((t) => {
          const on = active && t.franchiseId === active.franchiseId;
          return (
            <Pressable key={t.franchiseId} style={[styles.teamChip, on && styles.teamChipOn]} onPress={() => setSel(t.franchiseId)}>
              <Text style={[styles.teamChipName, on && { color: colors.text }]} numberOfLines={1}>{t.name}{t.mine ? ' ·you' : ''}</Text>
              <Text style={styles.teamChipVal}>{t.totalValue}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <FlatList
        data={active ? active.players : []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
        renderItem={({ item }) => (
          <Pressable style={styles.pRow} onPress={() => item.position !== 'PICK' && onOpenPlayer && onOpenPlayer(item.id)}>
            <View style={[styles.pDot, { backgroundColor: positionColors[item.position] || colors.textDim }]} />
            <Text style={styles.pName} numberOfLines={1}>{item.name}</Text>
            {item.slot === 'ir' ? <Text style={styles.pTag}>IR</Text> : item.slot === 'taxi' ? <Text style={styles.pTag}>TAXI</Text> : null}
            <Text style={styles.pMeta}>{item.position}{item.team ? ` · ${item.team}` : ''}</Text>
            <Text style={styles.pVal}>{item.value != null ? item.value : '—'}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No roster to show.</Text>}
      />
    </View>
  );
}

// --- Transactions -------------------------------------------------------------
function timeAgo(at) {
  if (!at) return '';
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - at);
  const d = Math.floor(secs / 86400);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(secs / 3600);
  if (h >= 1) return `${h}h`;
  const m = Math.floor(secs / 60);
  return m >= 1 ? `${m}m` : 'now';
}

function TransactionsTab({ leagueId, onOpenPlayer }) {
  const { data, error, refreshing, reload } = useTab(useCallback(() => api.leagueTransactions(leagueId), [leagueId]));
  if (error && !data) return <ErrorView message={error} onRetry={reload} onRefresh={reload} refreshing={refreshing} />;
  if (!data) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;

  return (
    <FlatList
      data={data.transactions}
      keyExtractor={(t) => t.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
      renderItem={({ item }) => (
        <View style={styles.txn}>
          <View style={styles.txnTop}>
            <Text style={styles.txnType}>{item.typeLabel}</Text>
            <Text style={styles.txnWho} numberOfLines={1}>
              {item.franchise ? item.franchise.name : ''}{item.withFranchise ? `  ⇄  ${item.withFranchise.name}` : ''}
            </Text>
            <Text style={styles.txnTime}>{timeAgo(item.at)}</Text>
          </View>
          {item.added.map((p) => (
            <Pressable key={`a${p.id}`} onPress={() => p.position !== 'PICK' && onOpenPlayer && onOpenPlayer(p.id)}>
              <Text style={styles.txnAdd} numberOfLines={1}>＋ {p.name}{p.position && p.position !== 'PICK' ? ` · ${p.position}` : ''}</Text>
            </Pressable>
          ))}
          {item.dropped.map((p) => (
            <Pressable key={`d${p.id}`} onPress={() => p.position !== 'PICK' && onOpenPlayer && onOpenPlayer(p.id)}>
              <Text style={styles.txnDrop} numberOfLines={1}>－ {p.name}{p.position && p.position !== 'PICK' ? ` · ${p.position}` : ''}</Text>
            </Pressable>
          ))}
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No recent transactions.</Text>}
    />
  );
}

function Center({ children }) {
  return <View style={styles.center}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 66 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900', flex: 1, textAlign: 'center' },
  segment: { flexDirection: 'row', marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3, marginTop: 6, marginBottom: 4 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: colors.cardAlt },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextActive: { color: colors.text },
  list: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 6 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 40, fontSize: 14 },

  // standings
  stHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 6 },
  stHeadText: { color: colors.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  stRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 11, marginBottom: 6 },
  stMine: { borderColor: colors.accent, backgroundColor: colors.cardAlt },
  stRank: { width: 26, color: colors.textDim, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stIn: { color: colors.good },
  stTeam: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', marginRight: 8 },
  stTeamMine: { color: colors.accent },
  stRec: { width: 52, color: colors.textDim, fontSize: 13, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  stPf: { width: 62, color: colors.gold, fontSize: 13, fontWeight: '800', textAlign: 'right', fontVariant: ['tabular-nums'] },
  playoffLine: { borderTopWidth: 1, borderTopColor: colors.gold, borderStyle: 'dashed', marginVertical: 6, alignItems: 'center' },
  playoffText: { color: colors.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 3 },

  // rosters
  chipRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 6 },
  teamChip: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, maxWidth: 170 },
  teamChipOn: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  teamChipName: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  teamChipVal: { color: colors.gold, fontSize: 12, fontWeight: '800', marginTop: 1 },
  pRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 7 },
  pDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  pName: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  pTag: { color: colors.warn, fontSize: 9, fontWeight: '900', marginLeft: 6, borderWidth: 1, borderColor: colors.warn, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1, overflow: 'hidden' },
  pMeta: { color: colors.textDim, fontSize: 12, marginLeft: 'auto', marginRight: 10 },
  pVal: { color: colors.gold, fontSize: 14, fontWeight: '900', width: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },

  // transactions
  txn: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  txnTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  txnType: { color: colors.accent, backgroundColor: colors.accent + '1A', borderRadius: 6, fontSize: 11, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden', marginRight: 8 },
  txnWho: { color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 },
  txnTime: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginLeft: 8 },
  txnAdd: { color: colors.good, fontSize: 13, fontWeight: '600', marginTop: 2 },
  txnDrop: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: 2 },
});
