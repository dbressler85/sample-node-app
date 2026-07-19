import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import SlotEditor from '../components/SlotEditor';

export default function LineupEditorScreen({ league, onBack }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignments, setAssignments] = useState([]); // slot index -> player id | null

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.lineupDetail(league.leagueId);
        if (!alive) return;
        setDetail(d);
        setAssignments(d.slots.map((s) => (s.current ? s.current.id : null)));
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

  const byId = useMemo(() => {
    const m = new Map();
    if (detail) for (const p of detail.players) m.set(p.id, p);
    return m;
  }, [detail]);

  const total = useMemo(
    () => Math.round(assignments.reduce((s, id) => s + (id && byId.get(id) ? byId.get(id).median : 0), 0) * 10) / 10,
    [assignments, byId]
  );

  const dirty = useMemo(() => {
    if (!detail) return false;
    return detail.slots.some((s, i) => (s.current ? s.current.id : null) !== assignments[i]);
  }, [detail, assignments]);

  function optimize() {
    setAssignments(detail.slots.map((s) => (s.optimal ? s.optimal.id : null)));
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api.applyLineup(league.leagueId, assignments.filter(Boolean));
      setDetail(updated);
      setAssignments(updated.slots.map((s) => (s.current ? s.current.id : null)));
      Alert.alert('Lineup saved', `${updated.name} · ${updated.current.total} projected points.`);
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.error}>{error}</Text>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const optimalDelta = Math.round((detail.optimal.total - total) * 10) / 10;

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Lineups</Text>
        </Pressable>
        <Pressable onPress={optimize} hitSlop={10}>
          <Text style={styles.optimize}>Optimize</Text>
        </Pressable>
      </View>

      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {detail.name}
        </Text>
        <Text style={styles.subtitle}>
          Week {detail.week} · projected <Text style={styles.totalStrong}>{total}</Text>
          {optimalDelta > 0.05 ? <Text style={styles.optHint}>  (+{optimalDelta} available)</Text> : null}
        </Text>
        {detail.format ? <Text style={styles.format}>{detail.format}</Text> : null}
        {detail.matchup ? (
          <>
            <Text style={styles.matchup}>
              vs {detail.matchup.opponent} ·{' '}
              <Text style={{ color: winColor(detail.matchup.winProb), fontWeight: '800' }}>
                {Math.round(detail.matchup.winProb * 100)}% win
              </Text>
              <Text style={styles.estTag}> est.</Text>
              {detail.mode ? <Text style={styles.modeTag}>  ·  {detail.mode.toUpperCase()}</Text> : null}
            </Text>
            <Text style={styles.basisTag}>
              {detail.matchup.basis === 'submitted'
                ? 'vs their set lineup'
                : 'assumes their best lineup (not set yet)'}
            </Text>
          </>
        ) : null}
      </View>

      <SlotEditor slots={detail.slots} players={detail.players} assignments={assignments} onChange={setAssignments} />

      <Pressable
        style={({ pressed }) => [styles.save, !dirty && styles.saveDisabled, pressed && dirty && { opacity: 0.85 }]}
        onPress={save}
        disabled={!dirty || saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{dirty ? 'Save Lineup' : 'Lineup Saved'}</Text>}
      </Pressable>
    </View>
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
  topbar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  optimize: { color: colors.good, fontSize: 15, fontWeight: '800' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  format: { color: colors.textDim, fontSize: 11, fontWeight: '700', marginTop: 4, letterSpacing: 0.3 },
  matchup: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  basisTag: { color: colors.textDim, fontSize: 11, marginTop: 2, fontStyle: 'italic', opacity: 0.8 },
  estTag: { color: colors.textDim, fontSize: 11, fontWeight: '700' },
  modeTag: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  totalStrong: { color: colors.text, fontWeight: '800' },
  optHint: { color: colors.warn, fontWeight: '700' },
  save: { backgroundColor: colors.accent, margin: 16, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveDisabled: { backgroundColor: colors.cardAlt },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  error: { color: colors.bad, textAlign: 'center', marginBottom: 16 },
  backBtn: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backText: { color: colors.text, fontWeight: '600' },
});
