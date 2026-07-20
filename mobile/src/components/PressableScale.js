import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';

// A Pressable that gives a tactile spring "press" — the content dips slightly on touch
// and springs back on release. Uses the native driver so it stays at 60fps regardless of
// JS work. Drop-in for any tappable card/button: pass the visual style, keep your onPress.
// `style` styles the animated inner view (so the whole visual scales on press).
// `pressableStyle` styles the outer touch target — use it for layout props like `flex`
// that must live on the Pressable itself (e.g. equal-width tab bar items).
export default function PressableScale({ children, style, pressableStyle, onPress, disabled, hitSlop, accessibilityLabel, dip = 0.96 }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v, bounciness) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness }).start();
  return (
    <Pressable
      style={pressableStyle}
      onPressIn={() => to(dip, 0)}
      onPressOut={() => to(1, 7)}
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
