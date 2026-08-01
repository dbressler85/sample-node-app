import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';

// The shared bottom-sheet shell for the cross-league "across" action sheets (Add / Trade-for / Shop)
// and any similar picker: a scrim that closes on tap, a card panel anchored to the bottom with a
// grabber, and a BOUNDED height so a long league list scrolls inside the sheet (the consumer wraps its
// list in a ScrollView with flexShrink) instead of growing the bottom-anchored panel up past the top
// edge and hiding the title/top rows — the bug that hit TradeAcrossSheet. Tapping inside the panel
// never closes it (the inner Pressable swallows the press).
export default function BottomSheet({ onClose, children, style }) {
  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={[styles.sheet, style]} onPress={() => {}}>
        <View style={styles.grabber} />
        {children}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
    maxHeight: '85%',
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 12 },
});
