import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, space, size, radius } from '../theme';

// The one "this data is incomplete" signal (docs/DESIGN_SYSTEM.md — honesty over false-complete).
// A cross-league read can drop a league to a throttle; the backend now reports loaded vs total, and
// this makes that visible instead of presenting a subset as done (the "owned in 8/8 when I'm in 15"
// trust bug). Renders nothing when the load is complete, so callers can mount it unconditionally.
// Warn-tinted (not error) and non-destructive: the data shown is real, it's just not all of it.
export default function PartialNote({ loaded, total, onRetry, noun = 'leagues', style }) {
  const l = Number(loaded);
  const t = Number(total);
  if (!Number.isFinite(l) || !Number.isFinite(t) || t <= 0 || l >= t) return null; // complete → nothing
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={2}>
        Showing <Text style={styles.strong}>{l} of {t}</Text> {noun} — the rest didn’t load.
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={10} accessibilityRole="button" accessibilityLabel="Retry loading the remaining leagues">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.warn + '14',
    borderColor: colors.warn + '55',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginVertical: space.sm,
  },
  dot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.warn, flex: 0 },
  text: { flex: 1, color: colors.textDim, fontSize: size.caption, lineHeight: 17 },
  strong: { color: colors.text, fontWeight: '800' },
  retry: { color: colors.accent, fontSize: size.caption, fontWeight: '800' },
});
