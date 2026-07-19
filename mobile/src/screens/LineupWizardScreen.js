import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import SlotEditor from '../components/SlotEditor';
import useAndroidBack from '../useAndroidBack';

const MODES = [
  { key: 'auto', label: 'Auto' },
  { key: 'safe', label: 'Safe' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'aggressive', label: 'Aggr' },
];

// Wizard that walks league-to-league, pre-filling each lineup with the suggested
// (optimal-for-mode) starters, letting the owner tweak, then submit and advance.
// `leagues` is the pre-filtered queue of leagues to step through.
export default function LineupWizardScreen({ leagues, initialMode = 'auto', onBack }) {
  const [mode, setMode] = useState(initialMode);
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState([]); // {leagueId, name, action, points}

  const total = leagues.length;
  const current = index < total ? leagues[index] : null;
  const done = index >= total;

  // Exit the wizard on hardware back (SlotEditor's picker consumes back first).
  useAndroidBack(
    useCallback(() => {
      onBack();
      return true;
    }, [onBack])
  );

  // Load (or reload on mode change) the current league's suggested lineup.
  useEffect(() => {
    if (!current) return;
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const d = await api.lineupDetail(current.leagueId, mode);
        if (!alive) return;
        setDetail(d);
        setAssignments(d.slots.map((s) => (s.optimal ? s.optimal.id : s.current ? s.current.id : null)));
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [current && current.leagueId, mode]);

  const byId = useMemo(() => {
    const m = new Map();
    if (detail) for (const p of detail.players) m.set(p.id, p);
    return m;
  }, [detail]);

  const projected = useMemo(
    () =>
      Math.round(assignments.reduce((s, id) => s + (id && byId.get(id) ? byId.get(id).median : 0), 0) * 10) / 10,
    [assignments, byId]
  );

  const emptySlots = useMemo(() => assignments.filter((id) => !id).length, [assignments]);

  function advance(result) {
    setResults((r) => [...r, result]);
    setDetail(null);
    setAssignments([]);
    setIndex((i) => i + 1);
  }

  async function submitAndNext() {
    setSubmitting(true);
    try {
      const updated = await api.applyLineup(current.leagueId, assignments.filter(Boolean), mode);
      advance({ leagueId: current.leagueId, name: current.name, action: 'set', points: updated.current.total });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function skip() {
    advance({ leagueId: current.leagueId, name: current.name, action: 'skipped' });
  }

  if (done) {
    return <Summary results={results} onBack={onBack} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.back}>‹ Done</Text>
        </Pressable>
        <Text style={styles.progress}>
          League {index + 1} of {total}
        </Text>
        <Text style={styles.skipTop} onPress={skip}>
          Skip
        </Text>
      </View>

      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.round((index / total) * 100)}%` }]} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.skipBtn} onPress={skip}>
            <Text style={styles.skipBtnText}>Skip this league</Text>
          </Pressable>
        </View>
      ) : detail ? (
        <>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {detail.name}
            </Text>
            <Text style={styles.subtitle}>
              Week {detail.week} · projected <Text style={styles.totalStrong}>{projected}</Text>
              {emptySlots > 0 ? <Text style={styles.emptyHint}>  · {emptySlots} empty</Text> : null}
            </Text>
            {detail.matchup ? (
              <>
                <Text style={styles.matchup}>
                  vs {detail.matchup.opponent} ·{' '}
                  <Text style={{ color: winColor(detail.matchup.winProb), fontWeight: '800' }}>
                    {Math.round(detail.matchup.winProb * 100)}% win
                  </Text>
                  {detail.mode ? <Text style={styles.modeTag}>  ·  suggested: {detail.mode.toUpperCase()}</Text> : null}
                </Text>
                <Text style={styles.basisTag}>
                  {detail.matchup.basis === 'submitted'
                    ? 'vs their set lineup'
                    : 'assumes their best lineup (not set yet)'}
                </Text>
              </>
            ) : (
              <Text style={styles.matchup}>Suggested lineup pre-filled — tweak any slot below.</Text>
            )}
          </View>

          <View style={styles.modeRow}>
            {MODES.map((m) => (
              <Pressable
                key={m.key}
                style={[styles.mode, mode === m.key && styles.modeActive]}
                onPress={() => setMode(m.key)}
              >
                <Text style={[styles.modeText, mode === m.key && styles.modeTextActive]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>

          <SlotEditor slots={detail.slots} players={detail.players} assignments={assignments} onChange={setAssignments} />

          <View style={styles.actions}>
            <Pressable style={styles.skipInline} onPress={skip} disabled={submitting}>
              <Text style={styles.skipInlineText}>Skip</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.submit, pressed && { opacity: 0.85 }]}
              onPress={submitAndNext}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>{index + 1 === total ? 'Submit & Finish' : 'Submit & Next'}</Text>
              )}
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function Summary({ results, onBack }) {
  const set = results.filter((r) => r.action === 'set');
  const skipped = results.filter((r) => r.action === 'skipped');
  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.doneMark}>✓</Text>
        <Text style={styles.doneTitle}>
          {set.length ? `${set.length} lineup${set.length === 1 ? '' : 's'} set` : 'No lineups changed'}
        </Text>
        {skipped.length ? <Text style={styles.doneSub}>{skipped.length} skipped</Text> : null}
        <View style={styles.summaryList}>
          {results.map((r) => (
            <View key={r.leagueId} style={styles.summaryRow}>
              <Text style={styles.summaryName} numberOfLines={1}>
                {r.name}
              </Text>
              {r.action === 'set' ? (
                <Text style={styles.summarySet}>{r.points} pts</Text>
              ) : (
                <Text style={styles.summarySkip}>skipped</Text>
              )}
            </View>
          ))}
        </View>
        <Pressable style={styles.doneBtn} onPress={onBack}>
          <Text style={styles.doneBtnText}>Back to Lineups</Text>
        </Pressable>
      </View>
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
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  progress: { color: colors.text, fontSize: 14, fontWeight: '800' },
  skipTop: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  bar: { height: 4, backgroundColor: colors.card, marginHorizontal: 16, marginTop: 10, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.accent },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  title: { color: colors.text, fontSize: 22, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  totalStrong: { color: colors.text, fontWeight: '800' },
  emptyHint: { color: colors.bad, fontWeight: '700' },
  matchup: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  basisTag: { color: colors.textDim, fontSize: 11, marginTop: 2, fontStyle: 'italic', opacity: 0.8 },
  modeTag: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  modeRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 4, marginBottom: 4, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 3 },
  mode: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  modeActive: { backgroundColor: colors.cardAlt },
  modeText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  modeTextActive: { color: colors.text },
  actions: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4, gap: 12 },
  skipInline: { paddingHorizontal: 22, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  skipInlineText: { color: colors.textDim, fontSize: 15, fontWeight: '700' },
  submit: { flex: 1, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  error: { color: colors.bad, textAlign: 'center', marginBottom: 16 },
  skipBtn: { backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  skipBtnText: { color: colors.text, fontWeight: '600' },
  // summary
  doneMark: { color: colors.good, fontSize: 56, fontWeight: '900', marginBottom: 8 },
  doneTitle: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  doneSub: { color: colors.textDim, fontSize: 14, marginTop: 4 },
  summaryList: { alignSelf: 'stretch', marginTop: 24, marginBottom: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  summaryName: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1, marginRight: 12 },
  summarySet: { color: colors.good, fontSize: 14, fontWeight: '800' },
  summarySkip: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  doneBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 40, alignItems: 'center', marginTop: 24 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
