import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

// A gentle, endless breathing pulse for "live" / "on the clock" indicators — the small
// motion that makes a status feel active rather than static. Native-driven opacity (and
// optional scale). Wrap any node; pass a style for the wrapper.
export default function Pulse({ children, style, min = 0.5, scale = 1, duration = 850 }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration]);

  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [1, min] });
  const transform = scale !== 1 ? [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, scale] }) }] : undefined;
  return <Animated.View style={[style, { opacity }, transform ? { transform } : null]}>{children}</Animated.View>;
}
