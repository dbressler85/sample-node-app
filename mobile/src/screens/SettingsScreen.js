import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Switch, ActivityIndicator, ScrollView, Linking } from 'react-native';
import { appAlert } from "../components/AppAlert";
import { api } from '../api';
import { colors } from '../theme';
import { displayLabel } from '../typography';
import { TopbarTitle } from '../components/Brand';
import useAndroidBack from '../useAndroidBack';
import ErrorView from '../components/ErrorView';
import { peekResource, primeResource } from '../useCachedResource';

// The push channels, in display order. `key` matches the backend pref key.
const CHANNELS = [
  { key: 'draftClock', label: 'On the clock', desc: 'When a draft reaches your pick.' },
  { key: 'tradeOffer', label: 'New trade offers', desc: 'When another owner sends you an offer.' },
  { key: 'lineupAttention', label: 'Lineup needs attention', desc: 'A start/sit problem before kickoff — an injured or empty starter.' },
  { key: 'watchlist', label: 'Watchlist alerts', desc: 'A player you track becomes a free agent or is put on the block.' },
  { key: 'waiverResult', label: 'Waiver results', desc: 'When a waiver claim of yours processes — you won a player (with the FAAB bid).' },
];

// Preferences: explicitly choose which push notifications to receive. Each toggle saves
// immediately (optimistic, reverts on failure). Channels default on.
export default function SettingsScreen({ onBack, onOpenHelp, onLogout }) {
  const confirmLogout = useCallback(() => {
    appAlert('Log out?', 'You’ll need your MFL username and password to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => onLogout && onLogout() },
    ]);
  }, [onLogout]);

  // Seed from cache so re-opening Settings (an overlay — unmounts on back) shows the switches instantly
  // instead of a spinner; the mount fetch revalidates. Push prefs rarely change.
  const [prefs, setPrefs] = useState(() => { const h = peekResource('settings:pushPrefs'); return h ? h.value : null; });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Fire a real push to THIS device now and report exactly where it lands, so "I never get
  // notifications" becomes diagnosable in one tap instead of waiting for a live draft/trade.
  const sendTest = useCallback(() => {
    setTesting(true);
    api.pushTest()
      .then((r) => {
        if (r && r.ok) {
          appAlert('Test sent', 'Your phone should show a Dynasty Central notification in a few seconds. If it doesn’t appear, make sure notifications are allowed for this app in your phone’s settings.', undefined, { tone: 'success' });
        } else if (r && r.reason === 'no-token') {
          appAlert('Not registered yet', 'This device hasn’t registered for push. Allow notifications for Dynasty Central in your phone settings, then fully close and reopen the app so it can register.', undefined, { tone: 'warn' });
        } else {
          const detail = r && r.errors && r.errors[0] ? (r.errors[0].code || r.errors[0].message || r.errors[0].detail) : 'unknown error';
          appAlert('Delivery failed', `The notification service rejected it: ${detail}. If this mentions credentials/FCM, Android push still needs to be configured for the app.`, undefined, { tone: 'error' });
        }
      })
      .catch((e) => appAlert('Couldn’t send test', e.message, undefined, { tone: 'error' }))
      .finally(() => setTesting(false));
  }, []);

  const [diagnosing, setDiagnosing] = useState(false);

  // Diagnose the WHOLE pipeline, not just delivery: a test push proves the device+FCM leg, but a
  // missing on-clock/trade alert can also be a dead background session (the poller has no cookie) or
  // a not-yet-primed device. This reads the server's own view and names the first broken link.
  const diagnose = useCallback(() => {
    setDiagnosing(true);
    api.pushStatus()
      .then((s) => {
        const lines = [];
        if (!s.registered) lines.push('• This device is NOT registered for push. Allow notifications, then fully close and reopen the app.');
        else lines.push('• Device registered ✓');
        lines.push(s.sessionLive ? '• Background session live ✓ (the server can check your drafts)' : '• No live background session — the server can’t poll your leagues while the app is closed. Re-open the app and sign in again.');
        if (s.registered) lines.push(s.primed ? '• Device primed ✓' : '• Device not yet primed — the first check after install only syncs state; on-clock alerts fire from the next check on.');
        if (Array.isArray(s.onClockNow)) {
          lines.push(s.onClockNow.length ? `• Server sees you ON THE CLOCK now in: ${s.onClockNow.map((d) => d.name).join(', ')}` : '• Server does not see you on the clock right now.');
        }
        if (!s.config.expoAccessToken) lines.push('• Owner: no Expo access token set — Android delivery (FCM) may be unconfigured.');
        if (!s.config.sessionSecret) lines.push('• Owner: SESSION_SECRET not set — background sessions are wiped on every backend redeploy (a likely cause of silent gaps).');
        appAlert('Notification diagnosis', lines.join('\n\n'), undefined, { tone: s.registered && s.sessionLive ? 'success' : 'warn' });
      })
      .catch((e) => appAlert('Couldn’t run diagnosis', e.message, undefined, { tone: 'error' }))
      .finally(() => setDiagnosing(false));
  }, []);

  useAndroidBack(useCallback(() => { onBack(); return true; }, [onBack]));

  const load = useCallback(() => {
    setError(null);
    api.pushPrefs()
      .then((r) => { const p = r.prefs || {}; setPrefs(p); primeResource('settings:pushPrefs', p); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = useCallback((key) => {
    setPrefs((cur) => {
      const next = { ...cur, [key]: !cur[key] };
      setSaving(true);
      api.setPushPrefs(next)
        .then((r) => { if (r && r.prefs) { setPrefs(r.prefs); primeResource('settings:pushPrefs', r.prefs); } })
        .catch(() => { setError('Could not save — tap a switch to retry'); setPrefs(cur); }) // revert
        .finally(() => setSaving(false));
      return next;
    });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={10}><Text style={styles.back}>‹ Hub</Text></Pressable>
        <TopbarTitle>Settings</TopbarTitle>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.sectionLabel, displayLabel()]}>Push notifications</Text>
        <Text style={styles.sectionHint}>
          Choose what reaches your phone. Notifications only fire while your MFL login is active.
        </Text>

        {/* Save-path errors are non-destructive (switches still show); the initial-load
            failure is a dead-end, so route it to a retryable ErrorView instead. */}
        {prefs != null && error ? <Text style={styles.error}>{error}</Text> : null}

        {prefs == null && error ? (
          <ErrorView message={error} onRetry={load} />
        ) : prefs == null ? (
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

        {/* Diagnostic: prove the pipeline end-to-end without waiting for a real event. */}
        <Pressable
          style={({ pressed }) => [styles.testBtn, pressed && { opacity: 0.7 }, testing && { opacity: 0.5 }]}
          onPress={sendTest}
          disabled={testing}
          accessibilityRole="button"
          accessibilityLabel="Send a test notification"
        >
          {testing ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.testBtnText}>Send a test notification</Text>}
        </Pressable>
        <Text style={styles.testHint}>Sends a push to this device right now to confirm notifications are working.</Text>

        {/* Deeper check: names the exact broken link (device / background session / priming / FCM). */}
        <Pressable
          style={({ pressed }) => [styles.diagnoseBtn, pressed && { opacity: 0.7 }, diagnosing && { opacity: 0.5 }]}
          onPress={diagnose}
          disabled={diagnosing}
          accessibilityRole="button"
          accessibilityLabel="Diagnose notifications"
        >
          {diagnosing ? <ActivityIndicator color={colors.textDim} /> : <Text style={styles.diagnoseBtnText}>Diagnose notifications</Text>}
        </Pressable>

        {onOpenHelp ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 26 }]}>Help</Text>
            <Pressable style={({ pressed }) => [styles.card, styles.helpRow, pressed && { opacity: 0.7 }]} onPress={onOpenHelp}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>How it works</Text>
                <Text style={styles.rowDesc}>Where values come from, how team outlook and trades are graded, league formats, waivers, and more.</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          </>
        ) : null}

        <Text style={[styles.sectionLabel, { marginTop: 26 }]}>Data & credits</Text>
        <View style={styles.card}>
          <Pressable style={({ pressed }) => [styles.creditRow, pressed && { opacity: 0.7 }]} onPress={() => Linking.openURL('https://fantasycalc.com').catch(() => {})}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>FantasyCalc.com</Text>
              <Text style={styles.rowDesc}>Player and draft-pick dynasty values are provided by FantasyCalc. Tap to visit.</Text>
            </View>
            <Text style={styles.chev}>↗</Text>
          </Pressable>
          <View style={styles.rowDivider} />
          <View style={styles.creditRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>MyFantasyLeague · Sleeper</Text>
              <Text style={styles.rowDesc}>League, roster, and transaction data come live from MyFantasyLeague; waiver-heat trends from Sleeper.</Text>
            </View>
          </View>
        </View>

        {onLogout ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 26 }]}>Session</Text>
            <Pressable style={({ pressed }) => [styles.card, styles.helpRow, pressed && { opacity: 0.7 }]} onPress={confirmLogout}>
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: colors.bad }]}>Log out</Text>
                <Text style={styles.rowDesc}>Sign out of MFL on this device.</Text>
              </View>
            </Pressable>
          </>
        ) : null}
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
  sectionLabel: { color: colors.violetText, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  sectionHint: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginBottom: 14 },
  center: { padding: 40, alignItems: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowText: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowDesc: { color: colors.textDim, fontSize: 12, marginTop: 3, lineHeight: 16 },
  footNote: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 14 },
  testBtn: { marginTop: 16, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.accent, paddingVertical: 11 },
  testBtnText: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  testHint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  // Secondary (quieter) than the test button — a diagnostic, not the primary action.
  diagnoseBtn: { marginTop: 10, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 10 },
  diagnoseBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  error: { color: colors.bad, fontSize: 13, marginBottom: 12 },
  helpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
  chev: { color: colors.textDim, fontSize: 22, fontWeight: '300' },
  creditRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12 },
});
