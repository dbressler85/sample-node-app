import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, BackHandler } from 'react-native';
import { colors, rgb, glow } from '../theme';
import { displayLabel } from '../typography';

// On-theme, blocking alert — the replacement for the immersion-breaking WHITE native `Alert.alert`.
// Same call shape as Alert.alert so it's a drop-in: appAlert(title, message, buttons, opts). One
// <AppAlertHost/> mounted at the app root renders it as a dark, neon-edged card in our colors/fonts.
//   buttons: [{ text, onPress?, style?: 'default' | 'cancel' | 'destructive' }] (defaults to one OK)
//   opts.tone: 'info' (default) | 'error' | 'warn' | 'success' — tints the neon edge + title.
// Default is a neutral accent so a blanket swap never turns a confirmation into an alarming red box;
// pass { tone: 'error' } at genuine failure sites.
let emit = null;
export function appAlert(title, message, buttons, opts = {}) {
  if (!emit) return;
  emit({
    title: title || null,
    message: message || null,
    buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }],
    tone: opts.tone || 'info',
    id: `${Date.now()}-${Math.random()}`,
  });
}

const TONE = { error: rgb.bad, warn: rgb.warn, info: rgb.accent, success: rgb.good };

export function AppAlertHost() {
  const [a, setA] = useState(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    emit = (payload) => setA(payload);
    return () => { emit = null; };
  }, []);

  useEffect(() => {
    if (!a) return undefined;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 9, tension: 90 }).start();
    // Hardware back dismisses (like tapping outside a native Alert) without firing a button action.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  function close(cb) {
    Animated.timing(anim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setA(null);
      if (typeof cb === 'function') cb();
    });
  }

  if (!a) return null;
  const triplet = TONE[a.tone] || TONE.error;
  return (
    <View style={styles.backdrop}>
      <Animated.View
        style={[
          styles.card,
          glow(triplet, { edge: 0.7, wash: 0.05, halo: 0.55, radius: 24 }),
          { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] },
        ]}
      >
        {a.title ? <Text style={[styles.title, displayLabel(), { color: `rgb(${triplet})` }]}>{a.title}</Text> : null}
        {a.message ? <Text style={styles.msg}>{a.message}</Text> : null}
        <View style={styles.btnRow}>
          {a.buttons.map((b, i) => {
            const c = b.style === 'destructive' ? colors.bad : b.style === 'cancel' ? colors.textDim : colors.accent;
            return (
              <Pressable
                key={`${b.text}-${i}`}
                style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
                onPress={() => close(b.onPress)}
                hitSlop={6}
              >
                <Text style={[styles.btnText, { color: c, fontWeight: b.style === 'cancel' ? '700' : '800' }]}>{b.text}</Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-screen dim that BLOCKS touches to the app beneath (a real modal), centered card.
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(3,6,12,0.66)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(12,17,30,0.98)',
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 12,
    // glow() supplies borderColor/backgroundColor wash + iOS halo; keep an Android elevation for lift.
    elevation: 14,
  },
  title: { fontSize: 18, fontWeight: '900', letterSpacing: 0.3, marginBottom: 8 },
  msg: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 18 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  btnText: { fontSize: 15, letterSpacing: 0.3 },
});
