import React from 'react';
import { Text, Pressable, StyleSheet, Linking } from 'react-native';
import { colors, space, size } from '../theme';

// RotoBaller attribution. Their partner program licenses the player-news feed for
// embedding on the condition that the source is credited with a visible, tappable link
// back to rotoballer.com. This is the one shared credit line so the News tab (and the
// profile News card) read it the same way and the link target stays in one place. Each
// news item also deep-links to its own RotoBaller story on tap.
const RB_URL = 'https://www.rotoballer.com';

export default function NewsCredit({ label = 'News', center = false, style }) {
  return (
    <Pressable
      onPress={() => Linking.openURL(RB_URL).catch(() => {})}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel="Player news from RotoBaller.com — open RotoBaller"
      style={({ pressed }) => [styles.row, center && styles.center, pressed && styles.pressed, style]}
    >
      <Text style={styles.text}>
        {label} · <Text style={styles.link}>RotoBaller.com</Text>
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
