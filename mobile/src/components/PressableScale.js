import React, { useRef } from 'react';
import { Animated, Pressable } from 'react-native';

// A Pressable that gives a tactile spring "press" — the content dips slightly on touch
// and springs back on release. Uses the native driver so it stays at 60fps regardless of
// JS work. Drop-in for any tappable card/button: pass the visual style, keep your onPress.
// `style` styles the animated inner view (so the whole visual scales on press).
// `pressableStyle` styles the outer touch target — use it for layout props like `flex`
// that must live on the Pressable itself (e.g. equal-width tab bar items).
export default function PressableScale({ children, style, pressableStyle, onPress, disabled, hitSlop, accessibilityLabel, dip = 0.94 }) {
  const scale = useRef(new Animated.Value(1)).current;
  // Press in quick and firm; release with a springy pop that overshoots 1 and settles — the
  // little bounce is what makes a tap feel alive rather than a flat state flip.
  const press = () => Animated.spring(scale, { toValue: dip, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const release = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 16 }).start();
  return (
    <Pressable
      style={pressableStyle}
      onPressIn={press}
      onPressOut={release}
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
