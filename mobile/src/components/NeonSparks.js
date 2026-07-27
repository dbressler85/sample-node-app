import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions, Platform } from 'react-native';
import { color as neonColor, sparkSpec } from '../neon';

// Neon sparks (docs/MOTION_AND_NEON_ROADMAP.md §3.5) — the retirement of paper confetti. A short burst
// of glowing tube-segments in the accent palette: a happy/hero moment throws a bright fan upward; a
// sad one gives a sparse, dim shower. Pure decoration over an absolute-fill, pointerEvents none.
// Reduce-motion renders nothing — the sign + caption still carry the moment (never strands content).

const { width: W, height: H } = Dimensions.get('window');

function makeSparks(mood) {
  const spec = sparkSpec(mood);
  return Array.from({ length: spec.count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    // Vary purely by index (deterministic — no Math.random dependency for the geometry seed), with a
    // cheap per-spark hash for organic spread.
    const j = (i * 9301 + 49297) % 233280;
    const r = j / 233280; // 0..1 pseudo-spread
    const x0 = spec.up
      ? (fromLeft ? 0.14 : 0.86) * W + (r - 0.5) * 90 * spec.spread
      : W * (0.3 + r * 0.4);
    const startY = spec.up ? H * 0.88 : -20;
    const travel = spec.up ? -(H * (0.4 + r * 0.4)) : H * (0.3 + r * 0.22);
    return {
      p: new Animated.Value(0),
      x0,
      startY,
      endY: startY + travel,
      driftX: spec.up ? (fromLeft ? 1 : -1) * (24 + r * 150) * spec.spread : (r - 0.5) * 44,
      spin: (r - 0.5) * 5,
      colorKey: spec.colors[i % spec.colors.length],
      len: spec.up ? 10 + r * 8 : 9 + r * 4,
      delay: r * (spec.up ? 200 : 150),
    };
  });
}

export default function NeonSparks({ mood = 'clean' }) {
  const sparks = useRef(makeSparks(mood)).current;

  useEffect(() => {
    const anim = Animated.parallel(
      sparks.map((s) =>
        Animated.timing(s.p, {
          toValue: 1,
          duration: mood === 'cold' ? 1700 : 1500,
          delay: s.delay,
          easing: mood === 'cold' ? Easing.in(Easing.quad) : Easing.out(Easing.quad),
          useNativeDriver: true,
        })
      )
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {sparks.map((s, i) => {
        const hex = neonColor(s.colorKey).hex;
        const halo =
          Platform.OS === 'ios'
            ? { shadowColor: hex, shadowOpacity: 0.95, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }
            : null;
        return (
          <Animated.View
            key={i}
            style={[
              {
                position: 'absolute',
                left: s.x0,
                top: 0,
                width: 2.5,
                height: s.len,
                borderRadius: 2,
                backgroundColor: hex,
                opacity: s.p.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
                transform: [
                  { translateY: s.p.interpolate({ inputRange: [0, 1], outputRange: [s.startY, s.endY] }) },
                  { translateX: s.p.interpolate({ inputRange: [0, 1], outputRange: [0, s.driftX] }) },
                  { rotate: s.p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${s.spin * 180}deg`] }) },
                ],
              },
              halo,
            ]}
          />
        );
      })}
    </View>
  );
}
