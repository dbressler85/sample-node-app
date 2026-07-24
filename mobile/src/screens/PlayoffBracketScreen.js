import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import ErrorView from '../components/ErrorView';
import useAndroidBack from '../useAndroidBack';
import useCachedResource from '../useCachedResource';

// The league's playoff bracket(s), rendered as columns of rounds (Wild Card → Championship). Each
// game shows both teams with seed + points; the winner is bolded with a ✓, the loser dimmed, and my
// franchise carries a gold accent so my path pops. Horizontally scrollable for deep brackets. A
// scouting/celebration view — read-only.

const fmtPts = (n) => (n == null ? '' : (Math.round(n * 10) / 10).toFixed(1));

function TeamRow({ side, isWinner, decided }) {
  if (!side) return <View style={[styles.teamRow, styles.teamRowEmpty]}><Text style={styles.tbd}>TBD</Text></View>;
  const dim = decided && !isWinner;
  return (
    <View style={[styles.teamRow, side.mine && styles.teamRowMine]}>
      {side.seed != null ? <Text style={[styles.seed, dim && styles.dimText]}>{side.seed}</Text> : <View style={styles.seedSpacer} />}
      <Text style={[styles.teamName, isWinner && styles.winnerName, dim && styles.dimText]} numberOfLines={1}>
        {side.mine ? '★ ' : ''}{side.name}
      </Text>
      {isWinner ? <Text style={styles.check}>✓</Text> : null}
      <Text style={[styles.pts, isWinner && styles.winnerPts, dim && styles.dimText]}>{fmtPts(side.points)}</Text>
    </View>
  );
}

function GameCard({ game }) {
  const decided = !!game.winnerFranchiseId;
  const homeWon = decided && game.home && game.winnerFranchiseId === game.home.franchiseId;
  const awayWon = decided && game.away && game.winnerFranchiseId === game.away.franchiseId;
  return (
    <View style={[styles.game, game.mine && styles.gameMine]}>
      <TeamRow side={game.home} isWinner={homeWon} decided={decided} />
      <View style={styles.gameDivider} />
      <TeamRow side={game.away} isWinner={awayWon} decided={decided} />
      {game.status === 'live' ? <Text style={styles.liveTag}>LIVE</Text> : null}
    </View>
  );
}

function RoundColumn({ round }) {
  return (
    <View style={styles.column}>
      <Text style={styles.roundTitle}>{round.title}</Text>
      {round.week != null ? <Text style={styles.roundWeek}>Week {round.week}</Text> : null}
      <View style={styles.games}>
        {round.games.map((g) => <GameCard key={g.id} game={g} />)}
        {!round.games.length ? <Text style={styles.tbd}>—</Text> : null}
      </View>
    </View>
  );
}

export default function PlayoffBracketScreen({ league, onBack }) {
  const leagueId = league.leagueId;
  const { data, error, refreshing, loading, reload } = useCachedResource(
    `league:playoffs:${leagueId}`,
    () => api.leaguePlayoffs(leagueId)
  );
  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const brackets = (data && data.brackets) || [];
  const [sel, setSel] = useState(0);
  const active = brackets[Math.min(sel, brackets.length - 1)] || null;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ {league.name || 'League'}</Text></Pressable>
        <Text style={styles.title}>Playoffs</Text>
        <View style={{ width: 54 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <ErrorView message={error} onRetry={reload} refreshing={refreshing} onRefresh={reload} />
      ) : !data || !data.available || !brackets.length ? (
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
        >
          <Text style={styles.emptyEmoji}>🏆</Text>
          <Text style={styles.emptyTitle}>No playoff bracket yet</Text>
          <Text style={styles.emptyText}>Brackets appear once the postseason is seeded. Check back when the fantasy playoffs begin.</Text>
        </ScrollView>
      ) : (
        <>
          {brackets.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {brackets.map((b, i) => (
                <Pressable key={b.id} onPress={() => setSel(i)} style={[styles.chip, i === sel && styles.chipOn]}>
                  <Text style={[styles.chipText, i === sel && styles.chipTextOn]}>{b.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.subtitle}>{active ? active.name : ''}</Text>
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.bracket}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />}
          >
            {active ? active.rounds.map((r, i) => <RoundColumn key={`${r.title}-${i}`} round={r} />) : null}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  back: { color: colors.accent, fontSize: 15, fontWeight: '700', maxWidth: 180 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: colors.textDim, fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 6 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  emptyText: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  chips: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontWeight: '800', fontSize: 13 },
  chipTextOn: { color: '#fff' },

  bracket: { paddingHorizontal: 12, paddingVertical: 8, gap: 14 },
  column: { width: 210 },
  roundTitle: { color: colors.gold, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  roundWeek: { color: colors.textDim, fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 2, marginBottom: 8 },
  // Games centered vertically so later (smaller) rounds sit beside the middle of the prior column.
  games: { flex: 1, justifyContent: 'space-around', gap: 12, paddingTop: 2 },

  game: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 4, overflow: 'hidden' },
  gameMine: { borderColor: colors.gold },
  gameDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 10 },
  teamRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10 },
  teamRowMine: { backgroundColor: 'rgba(243,193,74,0.08)' },
  teamRowEmpty: { opacity: 0.6 },
  seed: { width: 20, color: colors.textDim, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  seedSpacer: { width: 20 },
  teamName: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600', marginLeft: 2 },
  winnerName: { fontWeight: '800' },
  pts: { color: colors.textDim, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 42, textAlign: 'right' },
  winnerPts: { color: colors.text, fontWeight: '800' },
  check: { color: colors.good, fontSize: 13, fontWeight: '900', marginRight: 4 },
  dimText: { color: colors.textDim, opacity: 0.7 },
  tbd: { color: colors.textDim, fontSize: 12, fontStyle: 'italic', textAlign: 'center', padding: 8 },
  liveTag: { color: colors.warn, fontSize: 10, fontWeight: '900', letterSpacing: 1, textAlign: 'center', paddingBottom: 4 },
});
