import React, { useEffect, useState } from 'react';
import { View, Text, SectionList, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { api } from '../api';
import PlayerRow from '../components/PlayerRow';
import { colors } from '../theme';

export default function RosterScreen({ league, onBack, onOpenTrades, onOpenDraft }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.roster(league.leagueId);
        if (alive) setRoster(r);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [league.leagueId]);

  const sections = roster
    ? [
        { title: 'Starters', data: roster.starters },
        { title: 'Bench', data: roster.bench },
        { title: 'Injured Reserve', data: roster.ir },
        { title: 'Taxi Squad', data: roster.taxi },
      ].filter((s) => s.data && s.data.length > 0)
    : [];

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Leagues</Text>
        </Pressable>
        <View style={styles.topActions}>
          {onOpenDraft ? (
            <Pressable onPress={() => onOpenDraft(league)} hitSlop={10}>
              <Text style={styles.trades}>◆ Draft</Text>
            </Pressable>
          ) : null}
          {onOpenTrades ? (
            <Pressable onPress={() => onOpenTrades(league)} hitSlop={10}>
              <Text style={styles.trades}>⇄ Trades</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {league.name}
        </Text>
        {roster && roster.franchiseName ? <Text style={styles.subtitle}>{roster.franchiseName}</Text> : null}
      </View>

      {roster && roster.summary ? (
        <View style={styles.summary}>
          <Summary label="Roster value" value={roster.summary.rosterValue} />
          <Summary label="Core age" value={roster.summary.coreAge != null ? `${roster.summary.coreAge}y` : '—'} />
          <Summary label="Outlook" value={roster.summary.outlook} wide />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(p, i) => `${p.id}-${i}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>
              {section.title} · {section.data.length}
            </Text>
          )}
          renderItem={({ item }) => <PlayerRow player={item} />}
          ListFooterComponent={
            roster && roster.picks && roster.picks.length ? (
              <View>
                <Text style={styles.sectionHeader}>Rookie picks · {roster.picks.length}</Text>
                <View style={styles.picks}>
                  {roster.picks.map((pick, i) => (
                    <View key={i} style={styles.pickChip}>
                      <Text style={styles.pickText}>{pick}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

function Summary({ label, value, wide }) {
  return (
    <View style={[styles.summaryCell, wide && { flex: 1.4 }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  topActions: { flexDirection: 'row', gap: 16 },
  trades: { color: colors.accent, fontSize: 15, fontWeight: '800' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  summary: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 4, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  summaryCell: { flex: 1 },
  summaryLabel: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  summaryValue: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 3 },
  picks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  pickChip: { backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  pickText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  sectionHeader: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 4,
  },
  error: { color: colors.bad, textAlign: 'center' },
});
