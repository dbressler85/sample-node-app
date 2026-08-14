import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Button from './Button';
import { colors, space, size, radius } from '../theme';

// The one empty-state treatment (docs/DESIGN_SYSTEM.md §10): a short title, an optional line of
// context, and an optional CTA — no emoji (a neon glyph slots in at `accent` once the neon-sign
// system lands in Phase 4). Use for any "nothing here yet" list, so empties read intentional, not
// broken. `tone` tints the little bar; it defaults to a NEUTRAL structural hue — gold is reserved for
// VALUE (color law), and a "nothing here" state isn't value (matches the callers that already pass
// `tone={colors.textDim}`).
export default function EmptyView({ title, message, actionTitle, onAction, tone = colors.textDim, style }) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.bar, { backgroundColor: tone }]} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.msg}>{message}</Text> : null}
      {actionTitle && onAction ? (
        <Button title={actionTitle} onPress={onAction} variant="ghost" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.xs },
  bar: { width: 30, height: 3, borderRadius: radius.pill, marginBottom: space.md, opacity: 0.9 },
  title: { color: colors.text, fontSize: size.bodyLg, fontWeight: '800', textAlign: 'center' },
  msg: { color: colors.textDim, fontSize: size.bodySm, textAlign: 'center', lineHeight: 20, marginTop: space.xs, maxWidth: 320 },
  action: { marginTop: space.lg, alignSelf: 'center', paddingHorizontal: space.xxl },
});
