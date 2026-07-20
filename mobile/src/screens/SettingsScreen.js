import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Switch, ActivityIndicator, ScrollView } from 'react-native';
import { api } from '../api';
import { colors } from '../theme';
import useAndroidBack from '../useAndroidBack';

// The push channels, in display order. `key` matches the backend pref key.
const CHANNELS = [
  { key: 'draftClock', label: 'On the clock', desc: 'When a draft reaches your pick.' },
  { key: 'tradeOffer', label: 'New trade offers', desc: 'When another owner sends you an offer.' },
  { key: 'lineupAttention', label: 'Lineup needs attention', desc: 'A start/sit problem before kickoff — an injured or empty starter.' },
  { key: 'watchlist', label: 'Watchlist alerts', desc: 'A player you track becomes a free agent or is put on the block.' },
];

// Preferences: explicitly choose which push notifications to receive. Each toggle saves
// immediately (optimistic, reverts on failure). Channels default on.
export default function SettingsScreen({ onBack }) {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  useEffect(() => {
    api.pushPrefs()
      .then((r) => setPrefs(r.prefs || {}))
      .catch((e) => setError(e.message));
  }, []);

  const toggle = useCallback((key) => {
    setPrefs((cur) => {
      const next = { ...cur, [key]: !cur[key] };
      setSaving(true);
      api.setPushPrefs(next)
        .then((r) => { if (r && r.prefs) setPrefs(r.prefs); })
        .catch(() => { setError('Could not save — tap a switch to retry'); setPrefs(cur); }) // revert
        .finally(() => setSaving(false));
      return next;
    });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Home</Text></Pressable>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.sectionLabel}>Push notifications</Text>
        <Text style={styles.sectionHint}>
          Choose what reaches your phone. Notifications only fire while your MFL login is active.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {prefs == null && !error ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View>
        ) : (
          <View style={styles.card}>
            {CHANNELS.map((c, i) => (
              <View key={c.key} style={[styles.row, i < CHANNELS.length - 1 && styles.rowDivider]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{c.label}</Text>
                  <Text style={styles.rowDesc}>{c.desc}</Text>
                </View>
                <Switch
                  value={!!(prefs && prefs[c.key])}
                  onValueChange={() => toggle(c.key)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.border}
                />
              </View>
            ))}
          </View>
        )}
        <Text style={styles.footNote}>{saving ? 'Saving…' : 'Changes save automatically.'}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { color: colors.accent, fontSize: 16, fontWeight: '600', width: 60 },
  title: { color: colors.text, fontSize: 17, fontWeight: '900' },
  list: { padding: 16 },
  sectionLabel: { color: colors.accent, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  sectionHint: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginBottom: 14 },
  center: { padding: 40, alignItems: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowText: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowDesc: { color: colors.textDim, fontSize: 12, marginTop: 3, lineHeight: 16 },
  footNote: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 14 },
  error: { color: colors.bad, fontSize: 13, marginBottom: 12 },
});
