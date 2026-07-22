import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// Entrance motion: content fades and rises into place, decelerating so it lingers a beat as it
// settles. Pass an increasing `delay` to a group so cards/rows cascade in one after another.
// Native-driven (opacity + translateY). The timing always runs on mount and Animated completes
// even when OS "reduce motion" is on, so content reliably ends at its settled state.
export default function Reveal({ children, style, delay = 0, y = 16, duration = 480, animate = true }) {
  // `animate={false}` renders settled immediately — for rows in a virtualized list that mount
  // on scroll (only the first screenful should cascade; later rows shouldn't re-animate).
  const t = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return undefined;
    const anim = Animated.timing(t, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [t, delay, duration, animate]);
  if (!animate) return <Animated.View style={style}>{children}</Animated.View>;
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [y, 0] });
  return <Animated.View style={[style, { opacity: t, transform: [{ translateY }] }]}>{children}</Animated.View>;
}
