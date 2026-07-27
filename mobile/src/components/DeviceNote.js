import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, space, size } from '../theme';
import NeonSign from './NeonSign';

// The "live from MFL on-device" note (docs/DEVICE_ORIGIN_MFL.md), as one shared row so every screen
// reads it the same way — and so the old ⚡ emoji becomes a steady neon bolt (roadmap §3.7, inline
// grade: lit, no flicker). Pass the trailing copy as children or `text`.
export default function DeviceNote({ text, children, center = false, style }) {
  return (
    <View style={[styles.row, center && styles.center, style]}>
      <NeonSign glyph="bolt" grade="inline" color="accent" size={13} accessibilityLabel="Live on-device" />
      <Text style={styles.text}>{text || children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm },
  center: { justifyContent: 'center' },
  text: { color: colors.accent, fontSize: size.micro, fontWeight: '700' },
});
