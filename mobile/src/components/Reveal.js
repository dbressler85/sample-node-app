import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import useReducedMotion from '../useReducedMotion';

// Entrance motion: content fades and rises into place, decelerating so it lingers a beat as it
// settles. Pass an increasing `delay` to a group so cards/rows cascade in one after another.
// Native-driven (opacity + translateY). Respects OS "reduce motion" (renders settled, no tween),
// and even when animating it ends at the settled state, so content is never stranded.
export default function Reveal({ children, style, delay = 0, y = 16, duration = 480, animate = true }) {
  const reduced = useReducedMotion();
  // Settle immediately when reduce-motion is on OR `animate={false}` (the latter for rows in a
  // virtualized list that mount on scroll — only the first screenful should cascade).
  const settled = !animate || reduced;
  const t = useRef(new Animated.Value(settled ? 1 : 0)).current;
  useEffect(() => {
    if (settled) return undefined;
    const anim = Animated.timing(t, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration, settled]);
  if (settled) return <Animated.View style={style}>{children}</Animated.View>;
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [y, 0] });
  return <Animated.View style={[style, { opacity: t, transform: [{ translateY }] }]}>{children}</Animated.View>;
}
