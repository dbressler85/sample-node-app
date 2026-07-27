import React from 'react';
import { Pressable, Text, Animated } from 'react-native';
import usePopScale from '../usePopScale';

// A filter/sort chip that "pops" (a quick scale bump) the moment it becomes active — the Texture
// pop-on-toggle (docs/MOTION_AND_NEON_ROADMAP.md §2.3). Drop-in for the inline
// `<Pressable style={[chip, active && chipOn]}><Text .../></Pressable>` pattern: the chip visuals live
// on the inner Animated.View so the pop scales the whole pill. Reduce-motion collapses the pop (the
// hook returns a steady 1), so it never strands.
export default function PopChip({ active, onPress, style, activeStyle, textStyle, activeTextStyle, label, hitSlop = 6 }) {
  const scale = usePopScale(active);
  return (
    <Pressable onPress={onPress} hitSlop={hitSlop}>
      <Animated.View style={[style, active && activeStyle, { transform: [{ scale }] }]}>
        <Text style={[textStyle, active && activeTextStyle]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}
