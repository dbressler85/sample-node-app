import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The check square used by the cross-league sheets' rows: a filled box with a ✓ when `checked`, an
// empty bordered box otherwise. `color` is the checked fill (default accent; a destructive sheet like
// Drop passes `colors.bad` so the box reads red). `locked` dims it (checked but not toggleable — a
// league already on the block). `size` matches the sheet's row scale; the ✓ scales with it. Purely
// visual — the row's Pressable owns the toggle + a11y checkbox role/state.
export default function Checkbox({ checked, size = 24, locked = false, color = colors.accent, style }) {
  return (
    <View style={[styles.box, { width: size, height: size }, checked && { backgroundColor: color, borderColor: color }, locked && styles.locked, style]}>
      {checked ? <Text style={[styles.mark, { fontSize: size >= 24 ? 14 : 13 }]}>✓</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  locked: { opacity: 0.6 },
  mark: { color: colors.onAccent, fontWeight: '900' },
});
