import React from 'react';
import { Text, ActivityIndicator, StyleSheet } from 'react-native';
import PressableScale from './PressableScale';
import { colors, radius, space, size, weight } from '../theme';

// The one button primitive (docs/DESIGN_SYSTEM.md §10). Variants:
//   primary     — accent fill, DARK ink (onAccent) so the label passes WCAG AA (white-on-accent fails)
//   gold        — gold fill, dark ink (a value/championship CTA)
//   ghost       — bordered, no fill (secondary)
//   destructive — bad-tinted bordered (reject/withdraw)
// Always >=44pt tall, springs on press (PressableScale), and carries the button a11y role.
export default function Button({ title, onPress, variant = 'primary', busy = false, disabled = false, style, textStyle }) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const off = disabled || busy;
  return (
    <PressableScale
      style={[styles.base, v.box, off && styles.off, style]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityLabel={title}
    >
      {busy ? (
        <ActivityIndicator color={v.spinner} />
      ) : (
        <Text style={[styles.label, { color: v.fg }, textStyle]}>{title}</Text>
      )}
    </PressableScale>
  );
}

const VARIANTS = {
  primary: { box: { backgroundColor: colors.accent }, fg: colors.onAccent, spinner: colors.onAccent },
  gold: { box: { backgroundColor: colors.gold }, fg: colors.onAccent, spinner: colors.onAccent },
  ghost: { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }, fg: colors.text, spinner: colors.text },
  destructive: { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.bad }, fg: colors.bad, spinner: colors.bad },
};

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: size.bodyLg, fontWeight: weight.heavy },
  off: { opacity: 0.55 },
});
