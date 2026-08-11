import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  } from 'react-native';
import { appAlert } from "../components/AppAlert";
import { lineupsPreferDevice } from '../mflDevice';
import { colors } from '../theme';
import MatchupLine from '../components/MatchupLine';
import ErrorView from '../components/ErrorView';
import NavTools from '../components/NavTools';
import useCachedResource from '../useCachedResource';
import { ScreenTitle } from '../components/Brand';
import InfoDot from '../components/InfoDot';

const STATUS = {
  risk: { label: 'Risk', color: colors.bad },
  incomplete: { label: 'Empty slot', color: colors.warn },
  unset: { label: 'Not set', color: colors.warn },
  suboptimal: { label: 'Points available', color: colors.warn },
  optimal: { label: 'Optimal', color: colors.gold },
};

const MODES = [
  { key: 'auto', label: 'Auto' },
  { key: 'safe', label: 'Safe' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'aggressive', label: 'Aggr' },
];

// Two clearly-labeled paths for setting lineups (docs/LINEUP_FLOW_OPTIONS.md, owner decision):
//   1. Wizard  — the primary button walks every flagged league one at a time, each pre-filled with the
//                optimal lineup for the selected mode, adjustable before submit.
//   2. Editor  — tapping any league row opens its own lineup to review what's set and hand-adjust it.
// There is deliberately no third "bulk auto-set" path; it was the redundant flow the review flagged.
export default function LineupsScreen({ active = true, onOpenLineup, onStartWizard }) {
  const [mode, setMode] = useState('auto');

  // Stale-while-revalidate: paint the last lineups for this mode instantly, refetch
  // in the background. Keyed by mode so switching modes paints that mode's cache.
  const { data, error, refreshing, loading, reload } = useCachedResource(`lineups:${mode}`, () => lineupsPreferDevice(mode), { active });

  function startWizard() {
    const queue = (data ? data.leagues : []).filter((l) => !l.error && l.status !== 'optimal');
    if (!queue.length) {
      appAlert('All set', 'Every lineup is already optimal for this mode.');
      return;
    }
    onStartWizard(queue.map((l) => ({ leagueId: l.leagueId, name: l.name })), mode);
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const summary = data && data.summary;
  const needAttention = summary ? summary.needAttention : 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 20, top: 8, zIndex: 5 }}><NavTools active={active} /></View>
        <ScreenTitle focused={active}>Lineups</ScreenTitle>
        {summary ? (
          <Text style={styles.subtitle}>
            {needAttention === 0
              ? `All ${summary.total} lineups set · Week ${data.week}`
              : `${needAttention} of ${summary.total} need attention` +
                (summary.risky ? ` · ${summary.risky} risky` : '') +
                (summary.unset ? ` · ${summary.unset} not set` : '') +
                (summary.pointsAvailable > 0 ? ` · +${summary.pointsAvailable} pts` : '')}
          </Text>
        ) : null}
      </View>

      <View style={styles.modeHeader}>
        <Text style={styles.modeLabel}>OPTIMIZE FOR</Text>
        <InfoDot id="lineupModes" size={15} />
      </View>
      <ModeToggle mode={mode} onChange={setMode} />

      {/* Path 1 — the wizard. When nothing needs attention it would just pop an "All set" alert, so the
          button reads as a status instead of a dead-end. The per-league editor (tapping a row) still works. */}
      <Pressable
        style={({ pressed }) => [styles.setAll, needAttention === 0 && { opacity: 0.5 }, pressed && needAttention > 0 && { opacity: 0.85 }]}
        onPress={startWizard}
        disabled={needAttention === 0}
        accessibilityRole="button"
        accessibilityLabel={needAttention > 0 ? `Set lineups, ${needAttention} to review` : 'All lineups optimal'}
      >
        <Text style={styles.setAllText}>
          {needAttention > 0 ? `Set lineups · ${needAttention} to review` : '✓ All lineups optimal'}
        </Text>
      </Pressable>
      {needAttention > 0 ? (
        <Text style={styles.pathHelp}>
          Steps through each league one at a time, pre-filled with the optimal lineup — adjust before you submit.
        </Text>
      ) : null}

      {/* Path 2 — the per-league editor. Make the row-tap path explicit, not implicit. */}
      <Text style={styles.pathHelpDim}>Or tap a league below to review and adjust it on its own.</Text>

      {error && !data ? (
        <ErrorView message={error} onRetry={reload} onRefresh={reload} refreshing={refreshing} />
      ) : (
        <FlatList
          data={data ? data.leagues : []}
          keyExtractor={(l) => l.leagueId}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.accent} />
          }
          renderItem={({ item }) => <Row item={item} onPress={() => onOpenLineup(item)} />}
        />
      )}
    </View>
  );
}

function ModeToggle({ mode, onChange }) {
  return (
    <View style={styles.modeRow}>
      {MODES.map((m) => (
        <Pressable
          key={m.key}
          style={[styles.mode, mode === m.key && styles.modeActive]}
          onPress={() => onChange(m.key)}
        >
          <Text style={[styles.modeText, mode === m.key && styles.modeTextActive]}>{m.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Row({ item, onPress }) {
  if (item.error) {
    return (
      <View style={styles.row}>
        <Text style={styles.league}>{item.name}</Text>
        <Text style={styles.rowError}>{item.error}</Text>
      </View>
    );
  }
  const s = STATUS[item.status] || STATUS.optimal;
  const warnings = (item.warnings || []).filter((w) => w.playerId);
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <View style={styles.rowTop}>
        <Text style={styles.league} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={[styles.badge, { borderColor: s.color }]}>
          <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
        </View>
      </View>
      {item.format ? <Text style={styles.format}>{item.format}</Text> : null}

      {item.matchup ? <MatchupLine matchup={item.matchup} style={styles.matchup} /> : null}

      {warnings.length ? (
        <Text style={styles.warn} numberOfLines={2}>
          ⚠ {warnings.map((w, i) => {
            // Bye ≠ injury: a bye-week gap is a caution (warn), an injury/OUT is a real loss (bad).
            const isBye = /bye/i.test(w.status || '');
            return (
              <Text key={w.playerId || i} style={isBye ? { color: colors.warn } : null}>
                {i > 0 ? ' · ' : ''}{w.name.split(',')[0]} {w.status}
              </Text>
            );
          })}
        </Text>
      ) : null}

      <View style={styles.rowBottom}>
        {item.status === 'unset' ? (
          <Text style={styles.ptsDim}>Tap to set your starters</Text>
        ) : (
          <Text style={styles.pts}>
            <Text style={styles.ptsStrong}>{item.currentTotal}</Text>
            <Text style={[styles.ptsDim, { color: colors.gold }]}> / {item.optimalTotal} opt</Text>
          </Text>
        )}
        {item.status !== 'unset' && item.delta > 0 ? (
          <Text style={[styles.delta, { color: s.color }]}>+{item.delta}</Text>
        ) : (
          <Text style={styles.chev}>›</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  modeHeader: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10, gap: 6 },
  modeLabel: { color: colors.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  modeRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 6, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 },
  mode: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  modeActive: { backgroundColor: colors.cardAlt },
  modeText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  modeTextActive: { color: colors.text },
  setAll: { backgroundColor: colors.accent, marginHorizontal: 16, marginTop: 12, marginBottom: 6, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  setAllText: { color: colors.onAccent, fontSize: 16, fontWeight: '800' },
  pathHelp: { color: colors.textDim, fontSize: 12, marginHorizontal: 18, marginBottom: 8, lineHeight: 16 },
  pathHelpDim: { color: colors.textDim, fontSize: 12, marginHorizontal: 18, marginTop: 2, marginBottom: 4, opacity: 0.85, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 6 },
  row: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  league: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 10 },
  format: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginTop: 4, letterSpacing: 0.3 },
  matchup: { color: colors.textDim, fontSize: 12, marginTop: 6 },
  warn: { color: colors.bad, fontSize: 12, marginTop: 6, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  pts: { fontSize: 15 },
  ptsStrong: { color: colors.text, fontWeight: '800' },
  ptsDim: { color: colors.textDim },
  delta: { fontSize: 18, fontWeight: '900' },
  chev: { color: colors.textDim, fontSize: 22, fontWeight: '700' },
  rowError: { color: colors.bad, marginTop: 6, fontSize: 13 },
  error: { color: colors.bad, textAlign: 'center' },
});
