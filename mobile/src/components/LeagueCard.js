import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors } from '../theme';

// One league's weekly snapshot: matchup, live score, record, standing.
export default function LeagueCard({ league, onPress }) {
  const m = league.matchup;
  const winning = m && m.me && m.opponent && m.me.score >= m.opponent.score;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.league} numberOfLines={1}>
          {league.name}
        </Text>
        <View style={styles.metaRow}>
          {league.record ? <Text style={styles.meta}>{league.record}</Text> : null}
          {league.standingRank ? <Text style={styles.meta}>#{league.standingRank}</Text> : null}
          {league.week ? <Text style={styles.meta}>Wk {league.week}</Text> : null}
        </View>
      </View>

      {league.error ? (
        <Text style={styles.error}>Couldn't load: {league.error}</Text>
      ) : m && m.me ? (
        <View style={styles.matchup}>
          <Side name={m.me.name} score={m.me.score} highlight={winning} you />
          <Text style={styles.vs}>vs</Text>
          <Side
            name={m.opponent ? m.opponent.name : 'TBD'}
            score={m.opponent ? m.opponent.score : null}
            highlight={m.opponent && !winning}
            alignEnd
          />
        </View>
      ) : (
        <Text style={styles.dim}>No matchup this week</Text>
      )}
    </Pressable>
  );
}

function Side({ name, score, highlight, you, alignEnd }) {
  return (
    <View style={[styles.side, alignEnd && { alignItems: 'flex-end' }]}>
      <Text style={[styles.team, highlight && styles.teamHot]} numberOfLines={1}>
        {you ? '★ ' : ''}
        {name}
      </Text>
      <Text style={[styles.score, highlight && styles.teamHot]}>
        {score === null || score === undefined ? '—' : score.toFixed(1)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  league: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  metaRow: { flexDirection: 'row', gap: 8 },
  meta: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  matchup: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1 },
  team: { color: colors.textDim, fontSize: 13, marginBottom: 2 },
  teamHot: { color: colors.good },
  score: { color: colors.text, fontSize: 22, fontWeight: '800' },
  vs: { color: colors.textDim, fontSize: 12, marginHorizontal: 10 },
  dim: { color: colors.textDim, fontStyle: 'italic' },
  error: { color: colors.bad, fontSize: 13 },
});
