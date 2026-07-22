import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import { ScreenTitle } from '../components/Brand';
import { celebrate } from '../components/Celebrate';
import ErrorView from '../components/ErrorView';
import Pulse from '../components/Pulse';
import AnimatedNumber from '../components/AnimatedNumber';
import { getValue, setValue } from '../cache';
import useCachedResource from '../useCachedResource';
import usePoll from '../usePoll';

const STATUS = {
  favored: { label: 'Favored', color: colors.good },
  trailing: { label: 'Trailing', color: colors.bad },
  tossup: { label: 'Toss-up', color: colors.warn },
  won: { label: 'Won', color: colors.good },
  lost: { label: 'Lost', color: colors.bad },
};

export default function ScoresScreen({ onOpenLineup }) {
  // Stale-while-revalidate via the shared hook: paints the last board instantly on remount
  // (survives the tab-switch unmount), throttles redundant reloads, and keeps the board on a
  // failed refresh. `reload` forces a fetch (used by the live poll and pull-to-refresh).
  const { data, error, refreshing, loading, reload } = useCachedResource('scores:overview', () => api.scoreboard());

  // Auto-refresh the board whenever any matchup is still unlocked — so it also starts
  // ticking on its own if the tab was opened before kickoff, not only once a game is
  // already live. All games final (or none scheduled) → no poll.
  const hasUnlocked = !!(data && data.games && data.games.some((g) => !g.locked));
  usePoll(reload, 45000, hasUnlocked);

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
          <View style={styles.subtitleRow}>
            {s.live > 0 ? <Pulse style={styles.liveDot} min={0.25} /> : null}
            <Text style={styles.subtitle}>
              Week {data.week} · {s.live} live · {s.winning} winning · {s.close} close
            </Text>
          </View>
        ) : null}
      </View>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : (
        <FlatList
          data={data ? data.games : []}
          keyExtractor={(g) => g.leagueId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={reload}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => <Game g={item} onOpenLineup={onOpenLineup} />}
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

function Game({ g, onOpenLineup }) {
  const st = STATUS[g.status] || STATUS.tossup;
  const pct = Math.round(g.winProb * 100);
  // Tapping a matchup jumps to that league's lineup editor — the natural move when a game is
  // close and you want to check who's still on your bench. Unlocked games get a hint.
  const Wrap = onOpenLineup ? Pressable : View;
  const wrapProps = onOpenLineup ? { onPress: () => onOpenLineup({ leagueId: g.leagueId, name: g.name }) } : {};
  return (
    <Wrap style={({ pressed } = {}) => [styles.card, g.close && { borderColor: colors.warn }, pressed && { opacity: 0.8 }]} {...wrapProps}>
      <View style={styles.cardTop}>
        <Text style={styles.league} numberOfLines={1}>
          {g.name}
        </Text>
        <View style={styles.statusWrap}>
          {!g.locked ? <Pulse style={[styles.gameLiveDot, { backgroundColor: st.color }]} min={0.25} /> : null}
          <Text style={[styles.status, { color: st.color }]}>
            {g.close ? '⚡ ' : ''}
            {st.label}
          </Text>
        </View>
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
      <View style={styles.gameFoot}>
        <Text style={styles.wpText}>
          {pct}% win{!g.locked ? ` (est.) · ${g.me.yetToPlay + g.opp.yetToPlay} players left` : ' · final'}
        </Text>
        {onOpenLineup ? <Text style={styles.lineupHint}>{g.locked ? 'Lineup ›' : 'Set lineup ›'}</Text> : null}
      </View>
      {/* WHO you still have coming — the swing players behind the "N left" count. */}
      {!g.locked && g.me.yetToPlayers && g.me.yetToPlayers.length ? (
        <Text style={styles.ytpLine} numberOfLines={2}>
          <Text style={styles.ytpLabel}>Still to play  </Text>
          {g.me.yetToPlayers.map((p) => `${p.name.split(',')[0]}${p.position ? ` (${p.position})` : ''}`).join(', ')}
        </Text>
      ) : null}
    </Wrap>
  );
}

function Side({ label, score, proj, ytp, alignEnd, highlight }) {
  return (
    <View style={[styles.side, alignEnd && { alignItems: 'flex-end' }]}>
      <Text style={styles.sideLabel} numberOfLines={1}>
        {label}
      </Text>
      <AnimatedNumber value={score || 0} style={[styles.sideScore, highlight && { color: colors.good }]} duration={620} format={(n) => n.toFixed(1)} />

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
  subtitle: { color: colors.textDim, fontSize: 13 },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.good },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  league: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  status: { fontSize: 12, fontWeight: '800' },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gameLiveDot: { width: 7, height: 7, borderRadius: 3.5 },
  scoreRow: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1 },
  sideLabel: { color: colors.textDim, fontSize: 12, marginBottom: 2 },
  sideScore: { color: colors.text, fontSize: 24, fontWeight: '900' },
  sideProj: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  dash: { color: colors.textDim, fontSize: 16, marginHorizontal: 8 },
  wpTrack: { height: 6, backgroundColor: colors.cardAlt, borderRadius: 3, marginTop: 14, overflow: 'hidden' },
  wpFill: { height: 6, borderRadius: 3 },
  gameFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  wpText: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  lineupHint: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  ytpLine: { color: colors.text, fontSize: 12, marginTop: 8, lineHeight: 17, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8 },
  ytpLabel: { color: colors.textDim, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  error: { color: colors.bad, textAlign: 'center' },
  emptyWrap: { paddingHorizontal: 24, paddingTop: 60, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
