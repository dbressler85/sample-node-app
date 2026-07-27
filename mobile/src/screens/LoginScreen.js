import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { api } from '../api';
import { saveSession } from '../auth';
import { colors } from '../theme';
import NeonCrest, { CREST_IGNITE_MS } from '../components/NeonCrest';
import FieldBackdrop from '../components/FieldBackdrop';
import PressableScale from '../components/PressableScale';
import useReducedMotion from '../useReducedMotion';
import { displayXL, displayLabel } from '../typography';

export default function LoginScreen({ onLoggedIn, justLoggedOut = false }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reduced = useReducedMotion();
  // The crest's neon state (docs/MOTION_AND_NEON_ROADMAP.md §2.1). It rests UNLIT (dull glass) on a
  // fresh login and IGNITES when sign-in succeeds. Arriving here straight from a logout, it starts
  // LIT and flickers OUT — the mirror ("in mirrors out").
  const [ignited, setIgnited] = useState(justLoggedOut);
  // Ask the backend whether it's in demo mode, so the hint is honest in a live
  // deploy instead of always claiming any credentials work.
  const [demoMode, setDemoMode] = useState(null); // null = unknown yet

  // Entrance choreography: the crest springs in, the wordmark + form rise and fade up,
  // and the gold rule under "Central" wipes out from the center. One driver, native-driven.
  const intro = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    api.health().then((h) => setDemoMode(!!h.demoMode)).catch(() => setDemoMode(null));
    Animated.timing(intro, {
      toValue: 1,
      duration: 650,
      delay: 90,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [intro]);

  // Logout mirror: hold the lit sign a confident beat as the login flies back in, then flicker it out
  // to the resting unlit glass. Reduce-motion drops it straight to unlit.
  useEffect(() => {
    if (!justLoggedOut) return undefined;
    const t = setTimeout(() => setIgnited(false), reduced ? 0 : 460);
    return () => clearTimeout(t);
  }, [justLoggedOut, reduced]);

  const fade = { opacity: intro };
  const rise = { transform: [{ translateY: intro.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] };
  const pop = { transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] };
  const rule = { transform: [{ scaleX: intro }] };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { token, demoMode } = await api.login(username.trim(), password);
      await saveSession(token);
      // Threshold ceremony: the crest ignites, holds a beat, then hand off to the app fly-out. Keep
      // `busy` set through the ignition so the button can't be re-tapped mid-ceremony (no finally).
      setIgnited(true);
      const wait = reduced ? 0 : CREST_IGNITE_MS + 260;
      setTimeout(() => onLoggedIn({ demoMode }), wait);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Login gets a clean hero ground with NO embedded crest watermark — the big lit NeonCrest
          lockup below is the only crest here, so a faint second one behind it would just muddy it. */}
      <FieldBackdrop hero watermark={false} />
      <View style={styles.inner}>
        <Animated.View style={[styles.lockup, fade, pop]}>
          <NeonCrest size={196} ignited={ignited} />
        </Animated.View>

        <Animated.View style={[fade, rise]}>
          <Text style={[styles.brandTop, displayLabel()]}>DYNASTY</Text>
          <Text style={[styles.brandMain, displayXL()]}>Central</Text>
          <Animated.View style={[styles.rule, rule]} />
          <Text style={styles.tagline}>All your dynasties, centralized.</Text>

          {demoMode ? (
            <View style={styles.demoPill}>
              <Text style={styles.demoPillText}>DEMO MODE</Text>
            </View>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="MFL username"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />
          <TextInput
            style={styles.input}
            placeholder="MFL password"
            placeholderTextColor={colors.textDim}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PressableScale style={[styles.button, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log in</Text>}
          </PressableScale>

          <Text style={styles.hint}>
            {demoMode
              ? 'Demo mode — any username/password works. '
              : 'Enter your MyFantasyLeague username and password. '}
            Your credentials go only to your own backend, which logs into MFL on your behalf.
          </Text>
        </Animated.View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  inner: { padding: 28 },
  lockup: { alignItems: 'center', marginBottom: 6 },
  brandTop: { color: colors.textDim, fontSize: 13, fontWeight: '700', letterSpacing: 5, textAlign: 'center', marginLeft: 5 },
  brandMain: { color: colors.text, fontSize: 40, fontWeight: '900', textAlign: 'center', letterSpacing: -1, marginTop: 2 },
  // The gold rule wipes out from the center as the brand settles.
  rule: { alignSelf: 'center', width: 64, height: 3, borderRadius: 2, backgroundColor: colors.gold, marginTop: 10 },
  tagline: { color: colors.textDim, fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 22 },
  demoPill: { alignSelf: 'center', borderWidth: 1, borderColor: colors.gold, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 18 },
  demoPillText: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  input: {
    backgroundColor: 'rgba(20,28,48,0.85)',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  error: { color: colors.bad, marginBottom: 8 },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
