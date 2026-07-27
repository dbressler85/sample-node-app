import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, space, size, radius } from '../theme';

// The one "this data is incomplete" signal (docs/DESIGN_SYSTEM.md — honesty over false-complete).
// A cross-league read can drop a league to a throttle; the backend now reports loaded vs total, and
// this makes that visible instead of presenting a subset as done (the "owned in 8/8 when I'm in 15"
// trust bug). Renders nothing when the load is complete, so callers can mount it unconditionally.
// Warn-tinted (not error) and non-destructive: the data shown is real, it's just not all of it.
//
// `loading` = an auto-reload is healing the gap (useAutoReload): show live progress ("Loading N of M…"
// with a spinner) and hide the manual Retry, since it's already happening. When auto-retry is exhausted
// (loading=false but still partial), fall back to the "didn't load" wording + the manual Retry tap.
export default function PartialNote({ loaded, total, onRetry, loading = false, noun = 'leagues', style }) {
  const l = Number(loaded);
  const t = Number(total);
  if (!Number.isFinite(l) || !Number.isFinite(t) || t <= 0 || l >= t) return null; // complete → nothing
  return (
    <View style={[styles.wrap, style]}>
      {loading ? <ActivityIndicator size="small" color={colors.warn} style={styles.spin} /> : <View style={styles.dot} />}
      <Text style={styles.text} numberOfLines={2}>
        {loading ? (
          <>Loading <Text style={styles.strong}>{l} of {t}</Text> {noun}…</>
        ) : (
          <>Showing <Text style={styles.strong}>{l} of {t}</Text> {noun} — the rest didn’t load.</>
        )}
      </Text>
      {onRetry && !loading ? (
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
  spin: { width: 7, height: 7 },
  text: { flex: 1, color: colors.textDim, fontSize: size.caption, lineHeight: 17 },
  strong: { color: colors.text, fontWeight: '800' },
  retry: { color: colors.accent, fontSize: size.caption, fontWeight: '800' },
});
