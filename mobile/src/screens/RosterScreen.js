import React, { useEffect, useState } from 'react';
import { View, Text, SectionList, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { api } from '../api';
import PlayerRow from '../components/PlayerRow';
import { colors } from '../theme';

export default function RosterScreen({ league, onBack }) {
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
      </View>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {league.name}
        </Text>
        {league.franchiseName ? <Text style={styles.subtitle}>{league.franchiseName}</Text> : null}
      </View>

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
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  topbar: { paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
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
