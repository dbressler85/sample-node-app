import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import { ScreenTitle } from '../components/Brand';
import { celebrate } from '../components/Celebrate';
import { getValue, setValue } from '../cache';
import usePoll from '../usePoll';

const STATUS = {
  favored: { label: 'Favored', color: colors.good },
  trailing: { label: 'Trailing', color: colors.bad },
  tossup: { label: 'Toss-up', color: colors.warn },
  won: { label: 'Won', color: colors.good },
  lost: { label: 'Lost', color: colors.bad },
};

export default function ScoresScreen() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.scoreboard());
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
  // Auto-refresh the board whenever any matchup is still unlocked — so it also starts
  // ticking on its own if the tab was opened before kickoff, not only once a game is
  // already live. All games final (or none scheduled) → no poll.
  const hasUnlocked = !!(data && data.games && data.games.some((g) => !g.locked));
  usePoll(load, 45000, hasUnlocked);

  // Celebrate (or commiserate) when matchups go final — a 🏆 for a win, a deadpan
  // 💀 for a loss. First-seen tracking keyed by league+week+result, persisted to
  // disk, so a result fires its moment exactly once and never re-fires when you
  // reopen the tab or the board polls again. A mixed week shows the dominant mood.
  const seenRef = useRef(null);
  const [seenReady, setSeenReady] = useState(false);
  useEffect(() => {
    getValue('scores:celebrated').then((v) => {
      seenRef.current = new Set(Array.isArray(v) ? v : []);
      setSeenReady(true);
    });
  }, []);
  useEffect(() => {
    if (!seenReady || !data || !data.games || seenRef.current == null) return;
    const week = data.week;
    const finals = data.games.filter((g) => g.locked && (g.status === 'won' || g.status === 'lost'));
    const fresh = finals.filter((g) => !seenRef.current.has(`${g.leagueId}:${week}:${g.status}`));
    if (!fresh.length) return;
    fresh.forEach((g) => seenRef.current.add(`${g.leagueId}:${week}:${g.status}`));
    setValue('scores:celebrated', [...seenRef.current]);
    const wins = fresh.filter((g) => g.status === 'won').length;
    const losses = fresh.length - wins;
    celebrate(losses > wins ? 'matchupLost' : 'matchupWon');
  }, [data, seenReady]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const s = data && data.summary;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ScreenTitle>Scoreboard</ScreenTitle>
        {s ? (
          <Text style={styles.subtitle}>
            Week {data.week} · {s.live} live · {s.winning} winning · {s.close} close
          </Text>
        ) : null}
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={data ? data.games : []}
          keyExtractor={(g) => g.leagueId}
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
          renderItem={({ item }) => <Game g={item} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No live games right now</Text>
              <Text style={styles.emptyText}>
                The scoreboard lights up on game day. During the week and the offseason there's no live
                scoring to show. Pull down to refresh.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function Game({ g }) {
  const st = STATUS[g.status] || STATUS.tossup;
  const pct = Math.round(g.winProb * 100);
  return (
    <View style={[styles.card, g.close && { borderColor: colors.warn }]}>
      <View style={styles.cardTop}>
        <Text style={styles.league} numberOfLines={1}>
          {g.name}
        </Text>
        <Text style={[styles.status, { color: st.color }]}>
          {g.close ? '⚡ ' : ''}
          {st.label}
        </Text>
      </View>

      <View style={styles.scoreRow}>
        <Side label="You" score={g.me.score} proj={g.me.projectedFinal} ytp={g.me.yetToPlay} highlight={g.me.score >= g.opp.score} />
        <Text style={styles.dash}>—</Text>
        <Side label={g.opponent} score={g.opp.score} proj={g.opp.projectedFinal} ytp={g.opp.yetToPlay} alignEnd highlight={g.opp.score > g.me.score} />
      </View>

      {/* Win-probability bar */}
      <View style={styles.wpTrack}>
        <View style={[styles.wpFill, { width: `${pct}%`, backgroundColor: st.color }]} />
      </View>
      <Text style={styles.wpText}>
        {pct}% win{!g.locked ? ` (est.) · ${g.me.yetToPlay + g.opp.yetToPlay} players left` : ' · final'}
      </Text>
    </View>
  );
}

function Side({ label, score, proj, ytp, alignEnd, highlight }) {
  return (
    <View style={[styles.side, alignEnd && { alignItems: 'flex-end' }]}>
      <Text style={styles.sideLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.sideScore, highlight && { color: colors.good }]}>{(score || 0).toFixed(1)}</Text>
      <Text style={styles.sideProj}>
        proj {(proj || 0).toFixed(0)} · {ytp || 0} left
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  league: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  status: { fontSize: 12, fontWeight: '800' },
  scoreRow: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1 },
  sideLabel: { color: colors.textDim, fontSize: 12, marginBottom: 2 },
  sideScore: { color: colors.text, fontSize: 24, fontWeight: '900' },
  sideProj: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  dash: { color: colors.textDim, fontSize: 16, marginHorizontal: 8 },
  wpTrack: { height: 6, backgroundColor: colors.cardAlt, borderRadius: 3, marginTop: 14, overflow: 'hidden' },
  wpFill: { height: 6, borderRadius: 3 },
  wpText: { color: colors.textDim, fontSize: 11, marginTop: 6, fontWeight: '600' },
  error: { color: colors.bad, textAlign: 'center' },
  emptyWrap: { paddingHorizontal: 24, paddingTop: 60, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
