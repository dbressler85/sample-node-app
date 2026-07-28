import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { colors, positionColors } from '../theme';
import { TopbarTitle } from '../components/Brand';
import ErrorView from '../components/ErrorView';
import DeviceNote from '../components/DeviceNote';
import NeonSign from '../components/NeonSign';
import PopChip from '../components/PopChip';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';
import { leagueTeamsPreferDevice, standingsPreferDevice, transactionsPreferDevice } from '../mflDevice';

// The league hub: the ordinary league views the app was missing — Standings,
// Rosters (browse every team = opponent scouting), and a Transactions feed. Reached
// by tapping a league in the Leagues list.
const TABS = [
  ['standings', 'Standings'],
  ['rosters', 'Rosters'],
  ['txns', 'Transactions'],
];

export default function LeagueScreen({ league, onBack, onOpenPlayer, onOpenPlayoffs }) {
  const [tab, setTab] = useState('standings');
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Leagues</Text></Pressable>
        <TopbarTitle numberOfLines={1}>{league.name}</TopbarTitle>
        {onOpenPlayoffs ? (
          <Pressable onPress={() => onOpenPlayoffs(league)} hitSlop={10} style={styles.bracketBtn}>
            <NeonSign grade="inline" glyph="trophy" color="gold" size={14} />
            <Text style={styles.bracketBtnText}>Bracket</Text>
          </Pressable>
        ) : (
          <View style={{ width: 78 }} />
        )}
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

// Per-league sub-tabs load through the shared cache hook (survive-remount + throttle +
// non-destructive errors, unit-tested in test/resourceStore.test.js) — the bespoke useTab hook
// this replaced was a third reinvention of the same load/refresh/error logic with no caching.

// --- Standings ----------------------------------------------------------------
function StandingsTab({ leagueId }) {
  // Device-first: the leagueStandings export straight from MFL on-device + the backend directory
  // (names + playoff line); silently falls back to the backend on any device-read failure.
  const { data, error, refreshing, reload } = useCachedResource(`league:standings:${leagueId}`, () => standingsPreferDevice(leagueId));
  if (error && !data) return <ErrorView message={error} onRetry={reload} onRefresh={reload} refreshing={refreshing} />;
  if (!data) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;

  return (
    <FlatList
      data={data.standings}
      keyExtractor={(t) => t.franchiseId}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
      ListHeaderComponent={
        <View>
          {data._source === 'device' ? <DeviceNote center text="Standings live from MFL on-device" /> : null}
          <View style={styles.stHead}>
            <Text style={[styles.stRank, styles.stHeadText]}>#</Text>
            <Text style={[styles.stTeam, styles.stHeadText]}>Team</Text>
            <Text style={[styles.stRec, styles.stHeadText]}>W-L</Text>
            <Text style={[styles.stPf, styles.stHeadText]}>PF</Text>
          </View>
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
// Position filter chips (label 'K' maps to the normalized 'PK' code) and the sort options — the same
// filter/sort vocabulary the Players screen uses, so a scouted roster reads the same way as your own.
const ROSTER_POS = [[null, 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['PK', 'K'], ['DEF', 'DEF']];
const ROSTER_SORTS = [['value', 'Value'], ['name', 'Name'], ['pos', 'Pos']];
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, PK: 4, DEF: 5, PICK: 6 };

function RostersTab({ leagueId, onOpenPlayer }) {
  // Device-first: when device reads are enabled + ready, this league's rosters are fetched straight from
  // MFL on-device and enriched with the backend's player dictionary + franchise names; otherwise (or on
  // any device-read failure) it silently falls back to the backend. `_source` says which path served it.
  const { data, error, refreshing, reload } = useCachedResource(`league:teams:${leagueId}`, () => leagueTeamsPreferDevice(leagueId));
  const [sel, setSel] = useState(null);
  const [pos, setPos] = useState(null); // position filter (null = all)
  const [sort, setSort] = useState('value'); // value | name | pos

  // Your team pinned first in the chip bar (then value-sorted) so it's visible on open — otherwise a
  // value-sorted bar buries "you" off-screen to the right. The default selection is still your team.
  const teams = useMemo(
    () => (data && data.teams ? data.teams.slice().sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (b.totalValue || 0) - (a.totalValue || 0)) : []),
    [data]
  );
  const active = teams.find((t) => t.franchiseId === sel) || teams.find((t) => t.mine) || teams[0];

  // Filter by position, then sort. Value sinks nulls to the bottom; Pos groups by position then value.
  const shown = useMemo(() => {
    const list = (active ? active.players : []).filter((p) => !pos || p.position === pos);
    const byVal = (a, b) => (b.value == null ? -1 : a.value == null ? 1 : b.value - a.value);
    return list.slice().sort((a, b) => {
      if (sort === 'name') return String(a.name).localeCompare(String(b.name));
      if (sort === 'pos') return (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9) || byVal(a, b);
      return byVal(a, b);
    });
  }, [active, pos, sort]);

  if (error && !data) return <ErrorView message={error} onRetry={reload} onRefresh={reload} refreshing={refreshing} />;
  if (!data) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;

  return (
    <View style={{ flex: 1 }}>
      {data._source === 'device' ? (
        <DeviceNote center text={`Rosters live from MFL on-device · ${teams.length} teams`} />
      ) : null}
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
      <View style={styles.rFilterRow}>
        {ROSTER_POS.map(([k, label]) => (
          <PopChip key={label} active={pos === k} onPress={() => setPos(k)} style={styles.rChip} activeStyle={styles.rChipOn} textStyle={styles.rChipText} activeTextStyle={{ color: colors.text }} label={label} />
        ))}
      </View>
      <View style={styles.rSortRow}>
        <Text style={styles.rSortLabel}>Sort</Text>
        {ROSTER_SORTS.map(([k, label]) => (
          <PopChip key={k} active={sort === k} onPress={() => setSort(k)} style={styles.rSortChip} activeStyle={styles.rSortChipOn} textStyle={styles.rSortText} activeTextStyle={{ color: colors.text }} label={label} />
        ))}
      </View>
      <FlatList
        data={shown}
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
        ListEmptyComponent={<Text style={styles.empty}>{pos ? `No ${pos === 'PK' ? 'K' : pos}s on this roster.` : 'No roster to show.'}</Text>}
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
  // Device-first: the transactions export straight from MFL on-device, enriched with the backend
  // franchise directory + asset dictionary (players AND pick tokens); falls back to the backend on
  // any device-read failure. `_source` says which path served it.
  const { data, error, refreshing, reload } = useCachedResource(`league:txns:${leagueId}`, () => transactionsPreferDevice(leagueId));
  if (error && !data) return <ErrorView message={error} onRetry={reload} onRefresh={reload} refreshing={refreshing} />;
  if (!data) return <Center><ActivityIndicator color={colors.accent} size="large" /></Center>;

  return (
    <FlatList
      data={data.transactions}
      keyExtractor={(t) => t.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
      ListHeaderComponent={data._source === 'device' ? <DeviceNote center text="Transactions live from MFL on-device" /> : null}
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
  bracketBtn: { width: 78, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bracketBtnText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
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
  stPf: { width: 62, color: colors.text, fontSize: 13, fontWeight: '800', textAlign: 'right', fontVariant: ['tabular-nums'] },
  playoffLine: { borderTopWidth: 1, borderTopColor: colors.violet, borderStyle: 'dashed', marginVertical: 6, alignItems: 'center' },
  playoffText: { color: colors.violetText, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 3 },

  // rosters
  chipRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 6 },
  teamChip: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, maxWidth: 170 },
  teamChipOn: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  teamChipName: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  teamChipVal: { color: colors.gold, fontSize: 12, fontWeight: '800', marginTop: 1 },
  // Position filter + sort for the selected roster — same vocabulary as the Players screen.
  rFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, rowGap: 6, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 4 },
  rChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 5 },
  rChipOn: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  rChipText: { color: colors.textDim, fontSize: 12, fontWeight: '800' },
  rSortRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 4 },
  rSortLabel: { color: colors.violetText, fontSize: 12, fontWeight: '700', marginRight: 2 },
  rSortChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 5 },
  rSortChipOn: { backgroundColor: colors.cardAlt, borderColor: colors.accent },
  rSortText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  pRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 7 },
  pDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  pName: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  pTag: { color: colors.warn, fontSize: 9, fontWeight: '900', marginLeft: 6, borderWidth: 1, borderColor: colors.warn, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1, overflow: 'hidden' },
  pMeta: { color: colors.textDim, fontSize: 12, marginLeft: 'auto', marginRight: 10 },
  pVal: { color: colors.gold, fontSize: 14, fontWeight: '900', width: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },

  // transactions
  txn: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 },
  txnTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  txnType: { color: colors.violetText, backgroundColor: colors.violet + '22', borderRadius: 6, fontSize: 11, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden', marginRight: 8 },
  txnWho: { color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 },
  txnTime: { color: colors.textDim, fontSize: 11, fontWeight: '600', marginLeft: 8 },
  txnAdd: { color: colors.good, fontSize: 13, fontWeight: '600', marginTop: 2 },
  txnDrop: { color: colors.textDim, fontSize: 13, fontWeight: '600', marginTop: 2 },
});
