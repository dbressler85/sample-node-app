import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import AvailabilityBadge from '../components/AvailabilityBadge';
import useAndroidBack from '../useAndroidBack';

const STATUS = {
  risk: { label: 'Risk', color: colors.bad },
  incomplete: { label: 'Empty slot', color: '#ff9d5c' },
  suboptimal: { label: 'Points available', color: colors.warn },
  optimal: { label: 'Optimal', color: colors.good },
};

const MODES = [
  { key: 'auto', label: 'Auto' },
  { key: 'safe', label: 'Safe' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'aggressive', label: 'Aggr' },
];

export default function LineupsScreen({ onOpenLineup }) {
  const [mode, setMode] = useState('auto');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [plan, setPlan] = useState(null); // review sheet
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);

  // Back closes the review sheet first.
  useAndroidBack(useCallback(() => {
    if (plan) {
      setPlan(null);
      return true;
    }
    return false;
  }, [plan]));

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.lineups(mode));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function openReview() {
    setPlanning(true);
    try {
      const p = await api.planLineups(mode);
      const changed = p.leagues.filter((l) => l.changed);
      if (!changed.length) {
        Alert.alert('Nothing to change', 'Every lineup is already optimal for this mode.');
        return;
      }
      setPlan({ ...p, changed, selected: new Set(changed.map((l) => l.leagueId)) });
    } catch (e) {
      Alert.alert('Could not build plan', e.message);
    } finally {
      setPlanning(false);
    }
  }

  async function confirmApply() {
    const ids = Array.from(plan.selected);
    setApplying(true);
    try {
      const res = await api.applyAllLineups(
        mode,
        ids.map((leagueId) => ({ leagueId }))
      );
      setPlan(null);
      await load();
      Alert.alert('Lineups set', `${res.summary.leaguesUpdated} updated · +${res.summary.pointsGained} projected pts.`);
    } catch (e) {
      Alert.alert('Could not set lineups', e.message);
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const summary = data && data.summary;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Lineups</Text>
        {summary ? (
          <Text style={styles.subtitle}>
            {summary.needAttention === 0
              ? `All ${summary.total} lineups set · Week ${data.week}`
              : `${summary.needAttention} of ${summary.total} need attention` +
                (summary.risky ? ` · ${summary.risky} risky` : '') +
                ` · +${summary.pointsAvailable} pts`}
          </Text>
        ) : null}
      </View>

      <ModeToggle mode={mode} onChange={setMode} />

      <Pressable
        style={({ pressed }) => [styles.setAll, pressed && { opacity: 0.85 }]}
        onPress={openReview}
        disabled={planning}
      >
        {planning ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.setAllText}>Review &amp; Set All Lineups</Text>
        )}
      </Pressable>

      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={data ? data.leagues : []}
          keyExtractor={(l) => l.leagueId}
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
          renderItem={({ item }) => <Row item={item} onPress={() => onOpenLineup(item)} />}
        />
      )}

      {plan ? (
        <ReviewSheet
          plan={plan}
          applying={applying}
          onToggle={(id) =>
            setPlan((p) => {
              const selected = new Set(p.selected);
              if (selected.has(id)) selected.delete(id);
              else selected.add(id);
              return { ...p, selected };
            })
          }
          onCancel={() => setPlan(null)}
          onConfirm={confirmApply}
        />
      ) : null}
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

      {item.matchup ? (
        <Text style={styles.matchup}>
          vs {item.matchup.opponent} · <Text style={{ color: winColor(item.matchup.winProb) }}>{Math.round(item.matchup.winProb * 100)}% win</Text>
        </Text>
      ) : null}

      {warnings.length ? (
        <Text style={styles.warn} numberOfLines={2}>
          ⚠ {warnings.map((w) => `${w.name.split(',')[0]} ${w.status}`).join(' · ')}
        </Text>
      ) : null}

      <View style={styles.rowBottom}>
        <Text style={styles.pts}>
          <Text style={styles.ptsStrong}>{item.currentTotal}</Text>
          <Text style={styles.ptsDim}> / {item.optimalTotal} opt</Text>
        </Text>
        {item.delta > 0 ? <Text style={[styles.delta, { color: s.color }]}>+{item.delta}</Text> : <Text style={styles.chev}>›</Text>}
      </View>
    </Pressable>
  );
}

function ReviewSheet({ plan, applying, onToggle, onCancel, onConfirm }) {
  const selectedCount = plan.selected.size;
  const gained =
    Math.round(
      plan.changed.filter((l) => plan.selected.has(l.leagueId)).reduce((s, l) => s + (l.gained || 0), 0) * 10
    ) / 10;

  return (
    <Pressable style={styles.backdrop} onPress={onCancel}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <Text style={styles.sheetTitle}>Review changes</Text>
        <Text style={styles.sheetSub}>
          {plan.mode.toUpperCase()} · {plan.changed.length} league{plan.changed.length === 1 ? '' : 's'} would change
        </Text>
        <FlatList
          data={plan.changed}
          keyExtractor={(l) => l.leagueId}
          style={{ maxHeight: 380 }}
          renderItem={({ item }) => {
            const on = plan.selected.has(item.leagueId);
            return (
              <Pressable style={styles.planRow} onPress={() => onToggle(item.leagueId)}>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planName}>
                    {item.name} <Text style={styles.planGain}>+{item.gained}</Text>
                  </Text>
                  {item.adds.length ? (
                    <Text style={styles.planIn} numberOfLines={2}>
                      IN: {item.adds.map((p) => p.name.split(',')[0]).join(', ')}
                    </Text>
                  ) : null}
                  {item.drops.length ? (
                    <Text style={styles.planOut} numberOfLines={2}>
                      OUT: {item.drops.map((p) => p.name.split(',')[0]).join(', ')}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
        <Pressable
          style={({ pressed }) => [styles.confirm, (!selectedCount || applying) && styles.confirmOff, pressed && { opacity: 0.85 }]}
          onPress={onConfirm}
          disabled={!selectedCount || applying}
        >
          {applying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.confirmText}>
              Set {selectedCount} Lineup{selectedCount === 1 ? '' : 's'} · +{gained}
            </Text>
          )}
        </Pressable>
        <Pressable style={styles.cancel} onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  );
}

function winColor(p) {
  if (p >= 0.6) return colors.good;
  if (p <= 0.4) return colors.bad;
  return colors.warn;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  modeRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 10, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 },
  mode: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  modeActive: { backgroundColor: colors.cardAlt },
  modeText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  modeTextActive: { color: colors.text },
  setAll: { backgroundColor: colors.accent, marginHorizontal: 16, marginTop: 10, marginBottom: 6, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  setAllText: { color: '#fff', fontSize: 16, fontWeight: '800' },
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
  // review sheet
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderTopWidth: 1, borderColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: colors.textDim, fontSize: 12, marginTop: 2, marginBottom: 10, fontWeight: '600' },
  planRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 14 },
  planName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  planGain: { color: colors.good, fontWeight: '800' },
  planIn: { color: colors.good, fontSize: 12, marginTop: 3 },
  planOut: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  confirm: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  confirmOff: { backgroundColor: colors.cardAlt },
  confirmText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  cancel: { alignItems: 'center', paddingTop: 14 },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
});
