import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { api } from '../api';
import { saveSession } from '../auth';
import { colors } from '../theme';
import NeonCrest, { CREST_IGNITE_MS } from '../components/NeonCrest';
import FieldBackdrop from '../components/FieldBackdrop';
import PressableScale from '../components/PressableScale';
import useReducedMotion from '../useReducedMotion';
import { flickerPlan } from '../neon';
import { displayXL, displayLabel } from '../typography';

const SCREEN = Dimensions.get('window');
// The wall-wash light pool is a big soft circle centered on the sign. Sized to overspill the screen
// so its bright core sits behind the crest and the falloff reaches the edges of the "wall".
const WASH = Math.round(Math.max(SCREEN.width, SCREEN.height) * 1.5);

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

  // The wall-wash: a warm pool of light on the dark wall behind the sign. It rests OFF (a dark room)
  // and comes ON with the crest — driven by the SAME neon flicker plan so the light and the sign
  // catch together (light in a dark room). Starts lit on a logout arrival (mirror), then goes out.
  const glow = useRef(new Animated.Value(justLoggedOut ? 1 : 0)).current;
  const prevIgnited = useRef(ignited);

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
    // Hold the lit sign a longer, more confident beat before it goes dark — the logout ceremony read
    // a touch rushed at 460ms.
    const t = setTimeout(() => setIgnited(false), reduced ? 0 : 720);
    return () => clearTimeout(t);
  }, [justLoggedOut, reduced]);

  // The wall-wash tracks the sign: ignite → the light catches with the same flicker as the tubes;
  // extinguish → a quick stutter out. Only runs on an actual state CHANGE, so a fresh mount holds its
  // resting value (off on a normal open, on for a logout arrival) instead of flickering unprompted.
  useEffect(() => {
    const was = prevIgnited.current;
    prevIgnited.current = ignited;
    if (was === ignited) return undefined;
    if (reduced) { glow.setValue(ignited ? 1 : 0); return undefined; }
    let seq;
    if (ignited) {
      // Same plan the crest uses (NeonCrest) → the wall lights in lockstep with the tubes.
      const plan = flickerPlan({ tone: 'clean' });
      glow.setValue(0);
      seq = Animated.sequence(plan.frames.map((f) => Animated.timing(glow, { toValue: f.to, duration: f.dur, useNativeDriver: true })));
    } else {
      // Extinguish — a slower stutter to dark than before (the logout beat was a touch fast). Kept in
      // step with the crest's own extinguish timing (NeonCrest) so wall + sign go out together.
      seq = Animated.sequence([
        Animated.timing(glow, { toValue: 0.62, duration: 90, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.14, duration: 85, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.42, duration: 80, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]);
    }
    seq.start();
    return () => seq.stop();
  }, [ignited, reduced, glow]);

  const fade = { opacity: intro };
  const rise = { transform: [{ translateY: intro.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] };
  const pop = { transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] };
  const rule = { transform: [{ scaleX: intro }] };

  async function submit() {
    // Drop the keyboard first so it slides away before the ceremony — the neon crest ignition + fly-out
    // are fully visible instead of half-hidden behind the keyboard.
    Keyboard.dismiss();
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
      {/* The SAME dark "Deep Ink" ground the app uses — no hero gold and no embedded crest watermark:
          a true dark room where the only light comes from the sign itself. */}
      <FieldBackdrop watermark={false} />

      <View style={styles.inner}>
        <Animated.View style={[styles.lockup, fade, pop]}>
          {/* Wall-wash: the light the sign casts on the wall. A child of the lockup so it's centered on
              the crest BY CONSTRUCTION — it radiates from the logo neon (no measuring). It renders
              behind the crest; the wordmark/form paint on top of the lit wall. `glow` (flickering with
              the tubes) drives its opacity. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.wash, { opacity: glow, transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}
          >
            <Svg width={WASH} height={WASH} viewBox="0 0 100 100">
              <Defs>
                {/* Warm neon spill — a hot near-white core melting through value-gold to nothing. */}
                <RadialGradient id="wallWash" cx="0.5" cy="0.5" r="0.5">
                  <Stop offset="0" stopColor="#FFF4D6" stopOpacity="0.55" />
                  <Stop offset="0.2" stopColor="#F3C14A" stopOpacity="0.30" />
                  <Stop offset="0.5" stopColor="#B67C28" stopOpacity="0.11" />
                  <Stop offset="1" stopColor="#F3C14A" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Rect x="0" y="0" width="100" height="100" fill="url(#wallWash)" />
            </Svg>
          </Animated.View>
          <NeonCrest size={216} ignited={ignited} />
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
  // The wall-wash light pool — a big soft circle absolutely centered on its parent (the crest lockup),
  // so it radiates from the sign. left/top 50% + negative half-margins center the WASH-sized square.
  wash: { position: 'absolute', width: WASH, height: WASH, left: '50%', top: '50%', marginLeft: -WASH / 2, marginTop: -WASH / 2 },
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
