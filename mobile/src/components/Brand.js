import React from 'react';
import { Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

// Shared "broadcast" treatment so the flair stays consistent in one place.
// ScreenTitle: condensed, uppercase, tracked — the lower-third look. (When we
// bundle Saira Condensed / Oswald via expo-font, set fontFamily here once and it
// applies everywhere.) Value: championship-gold, tabular numerals for columns.
export function ScreenTitle({ children, style }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Value({ children, size = 22, color = colors.gold, style }) {
  return <Text style={[styles.value, { fontSize: size, color }, style]}>{children}</Text>;
}

// A faint gold crest ghosted into a header — quiet texture that ties every screen
// to the same franchise. Position it absolutely in the header container.
export function CrestWatermark({ size = 190, style }) {
  return (
    <Svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 200 220" style={[styles.wm, style]}>
      <Path
        d="M100 14 C66 28 44 32 28 34 L28 112 C28 164 62 196 100 210 C138 196 172 164 172 112 L172 34 C156 32 134 28 100 14 Z"
        fill="none"
        stroke={colors.gold}
        strokeWidth={4}
      />
      <Path d="M56 132 L68 78 L86 106 L100 66 L114 106 L132 78 L144 132 Z" fill={colors.gold} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 27, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  value: { fontWeight: '900', color: colors.gold, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  wm: { position: 'absolute', right: -34, top: -26, opacity: 0.05 },
});
