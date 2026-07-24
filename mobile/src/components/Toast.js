import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { colors } from '../theme';

// On-theme, non-blocking toast — the replacement for immersion-breaking white `Alert` popups on a
// plain success/info. A tiny global bus mirrors celebrate(): `toast('16 assets shopped')` from
// anywhere; one <ToastHost/> mounted at the app root shows it as a bottom banner. Because it doesn't
// dim or block (pointerEvents="none"), the confetti burst behind it stays visible — the exact thing
// the old Alert covered up. Confirmations that need a choice stay as Alerts; this is for "done"
// messages only.
let emit = null;
export function toast(message, opts = {}) {
  if (emit && message) emit({ message, tone: opts.tone || 'success' });
}

const TONE = {
  success: { color: colors.good, icon: '✓' },
  info: { color: colors.accent, icon: 'ℹ' },
  error: { color: colors.bad, icon: '⚠' },
};

export function ToastHost() {
  const [t, setT] = useState(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  useEffect(() => {
    emit = (payload) => setT({ ...payload, id: `${Date.now()}-${Math.random()}` });
    return () => { emit = null; };
  }, []);

  useEffect(() => {
    if (!t) return undefined;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 80 }).start();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 260, useNativeDriver: true }).start(() => setT(null));
    }, 2600);
    return () => clearTimeout(timer.current);
  }, [t, anim]);

  if (!t) return null;
  const tone = TONE[t.tone] || TONE.success;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [50, 0] }) }] }]}
    >
      <View style={[styles.toast, { borderColor: tone.color }]}>
        <Text style={[styles.icon, { color: tone.color }]}>{tone.icon}</Text>
        <Text style={styles.msg} numberOfLines={3}>{t.message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 92, alignItems: 'center', paddingHorizontal: 20 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '92%',
    backgroundColor: 'rgba(10,15,28,0.96)',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  icon: { fontSize: 16, fontWeight: '900' },
  msg: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
});
