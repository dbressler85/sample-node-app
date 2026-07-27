import React from 'react';
import { Text, Pressable, StyleSheet, Linking } from 'react-native';
import { colors, space, size } from '../theme';

// FantasyCalc attribution. Their Terms of Use ask that any screen using their data credit
// "FantasyCalc" / "FantasyCalc.com" in close proximity to the data, with a visible tappable
// link back to the site. This is the one shared credit line so every value-bearing screen
// reads it the same way and the link target stays in one place.
const FC_URL = 'https://fantasycalc.com';

export default function ValueCredit({ label = 'Values', center = false, style }) {
  return (
    <Pressable
      onPress={() => Linking.openURL(FC_URL).catch(() => {})}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel="Player values from FantasyCalc.com — open FantasyCalc"
      style={({ pressed }) => [styles.row, center && styles.center, pressed && styles.pressed, style]}
    >
      <Text style={styles.text}>
        {label} · <Text style={styles.link}>FantasyCalc.com</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'flex-start', paddingVertical: space.xs },
  center: { alignSelf: 'center' },
  pressed: { opacity: 0.6 },
  text: { color: colors.textDim, fontSize: size.micro, fontWeight: '600' },
  link: { color: colors.accent, fontWeight: '700', textDecorationLine: 'underline' },
});
