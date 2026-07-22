import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text } from 'react-native';

// A headline number that counts up to its value — vibrancy for the stats that carry weight
// (portfolio total, live scores, roster value). Rolls from 0 on mount and from the old value on
// change, decelerating so the last digits tick over slowly enough to notice. Drives text content
// (no native driver), so reserve it for a handful of big numbers — never list rows.
export default function AnimatedNumber({ value, style, duration = 780, format }) {
  const fmt = format || ((n) => Math.round(n).toLocaleString());
  const v = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const id = v.addListener((s) => setDisplay(s.value));
    const anim = Animated.timing(v, {
      toValue: Number(value) || 0,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => {
      anim.stop();
      v.removeListener(id);
    };
  }, [value, duration, v]);
  return <Text style={style}>{fmt(display)}</Text>;
}
