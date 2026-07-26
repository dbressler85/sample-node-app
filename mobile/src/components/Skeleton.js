import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';
import useReducedMotion from '../useReducedMotion';

// A shimmering placeholder block for loading states (docs/DESIGN_SYSTEM.md §10) — compose several
// into a screen-shaped skeleton (e.g. a roster/list skeleton) instead of a bare spinner, so a load
// reads as "content arriving" rather than "empty." Native-driven opacity pulse; respects reduce-motion
// (renders a static block). `w`/`h`/`r` size it; pass `style` for layout (margins, flex).
export default function Skeleton({ w, h = 14, r = radius.sm, style }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, reduced]);
  const opacity = reduced ? 0.5 : v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  return (
    <Animated.View
      style={[{ width: w, height: h, borderRadius: r, backgroundColor: colors.cardAlt, opacity }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
