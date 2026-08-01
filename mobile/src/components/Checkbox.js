import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The check square used by the cross-league "across" sheets' rows: an accent-filled box with a ✓ when
// `checked`, an empty bordered box otherwise. `locked` dims it (a row that's checked but can't be
// toggled — e.g. a league already on the block). `size` matches the sheet's row scale; the ✓ scales
// with it. Purely visual — the row's Pressable owns the toggle + a11y checkbox role/state.
export default function Checkbox({ checked, size = 24, locked = false, style }) {
  return (
    <View style={[styles.box, { width: size, height: size }, checked && styles.on, locked && styles.locked, style]}>
      {checked ? <Text style={[styles.mark, { fontSize: size >= 24 ? 14 : 13 }]}>✓</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  locked: { opacity: 0.6 },
  mark: { color: colors.onAccent, fontWeight: '900' },
});
