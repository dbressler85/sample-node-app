import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { GlyphMark } from './NeonGlyphs';

// The check square used by the cross-league sheets' rows: a filled box with a check when `checked`, an
// empty bordered box otherwise. `color` is the checked fill (default accent; a destructive sheet like
// Drop passes `colors.bad` so the box reads red). `locked` dims it (checked but not toggleable — a
// league already on the block). `size` matches the sheet's row scale; the tick scales with it. Purely
// visual — the row's Pressable owns the toggle + a11y checkbox role/state. The tick is the shared
// vector `check` glyph (DESIGN_SYSTEM.md §11 — no emoji), stroked in the box's on-fill ink.
export default function Checkbox({ checked, size = 24, locked = false, color = colors.accent, style }) {
  return (
    <View style={[styles.box, { width: size, height: size }, checked && { backgroundColor: color, borderColor: color }, locked && styles.locked, style]}>
      {checked ? <GlyphMark name="check" size={Math.round(size * 0.72)} color={colors.onAccent} weight={2.6} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  locked: { opacity: 0.6 },
});
