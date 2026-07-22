import React, { useEffect, useState } from 'react';
import { View, Text, SectionList, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { api } from '../api';
import PlayerRow from '../components/PlayerRow';
import Reveal from '../components/Reveal';
import { colors } from '../theme';

export default function RosterScreen({ league, onBack, onOpenTrades, onOpenDraft, onOpenPlayer }) {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [baited, setBaited] = useState(() => new Set()); // player ids on the block here

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, bait] = await Promise.all([
          api.roster(league.leagueId),
          api.leagueBait(league.leagueId).catch(() => ({ ids: [] })),
        ]);
        if (alive) {
          setRoster(r);
          setBaited(new Set((bait.ids || []).map(String)));
        }
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

  // Optimistically flip the block state, then persist; revert on failure.
  const toggleBait = async (player) => {
    const id = String(player.id);
    const on = baited.has(id);
    setBaited((cur) => {
      const next = new Set(cur);
      on ? next.delete(id) : next.add(id);
      return next;
    });
    try {
      if (on) await api.removeBait(league.leagueId, id);
      else await api.addBait(league.leagueId, id, null);
    } catch (e) {
      setBaited((cur) => {
        const next = new Set(cur);
        on ? next.add(id) : next.delete(id);
        return next;
      });
    }
  };

  const sections = roster
    ? [
        { title: 'Starters', data: roster.starters },
        { title: 'Bench', data: roster.bench },
        { title: 'Injured Reserve', data: roster.ir },
        { title: 'Taxi Squad', data: roster.taxi },
      ].filter((s) => s.data && s.data.length > 0)
    : [];

  // Combined dynasty value of the draft picks (when they're the enriched objects).
  const picksTotal = roster && roster.picks && roster.picks.length && typeof roster.picks[0] === 'object'
    ? roster.picks.reduce((sum, p) => sum + (p.value || 0), 0)
    : null;

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
          <Summary label="Roster value" value={roster.summary.rosterValue} gold />
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
          renderItem={({ item, index }) => (
            <Reveal delay={Math.min(index, 12) * 32} animate={index < 14}>
              <PlayerRow player={item} baited={baited.has(String(item.id))} onToggleBait={toggleBait} onOpenPlayer={onOpenPlayer} />
            </Reveal>
          )}
          ListFooterComponent={
            roster && roster.picks && roster.picks.length ? (
              <View>
                <Text style={styles.sectionHeader}>
                  Draft picks · {roster.picks.length}
                  {picksTotal != null ? <Text style={styles.picksTotal}>{`  ·  ${picksTotal} value`}</Text> : null}
                </Text>
                <View style={styles.picks}>
                  {roster.picks.map((pick, i) => {
                    // Backend now sends pick objects ({token,label,value}); tolerate an old
                    // cached string just in case.
                    const label = typeof pick === 'string' ? pick : pick.label;
                    const token = typeof pick === 'string' ? null : pick.token;
                    const value = typeof pick === 'string' ? null : pick.value;
                    const tappable = token && onOpenTrades;
                    const Chip = tappable ? Pressable : View;
                    const chipProps = tappable
                      ? { onPress: () => onOpenTrades(league, 'propose', { sendPickToken: token }) }
                      : {};
                    return (
                      <Chip
                        key={i}
                        style={({ pressed }) => [styles.pickChip, tappable && styles.pickChipTappable, pressed && { opacity: 0.7 }]}
                        {...chipProps}
                      >
                        <Text style={styles.pickText}>{label}</Text>
                        {value != null ? (
                          <Text style={styles.pickMeta}>val {value}{tappable ? '  ·  Trade ›' : ''}</Text>
                        ) : null}
                      </Chip>
                    );
                  })}
                </View>
                <Text style={styles.picksHint}>Tap a pick to shop it — opens the trade desk with it on your side.</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

function Summary({ label, value, wide, gold }) {
  return (
    <View style={[styles.summaryCell, wide && { flex: 1.4 }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, gold && { color: colors.gold }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
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
  pickChip: { backgroundColor: colors.cardAlt, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: colors.border },
  pickChipTappable: { borderColor: colors.accent + '77' },
  pickText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  pickMeta: { color: colors.accent, fontSize: 11, fontWeight: '700', marginTop: 2 },
  picksTotal: { color: colors.gold, fontSize: 13, fontWeight: '800' },
  picksHint: { color: colors.textDim, fontSize: 11, marginTop: 8, lineHeight: 15 },
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
