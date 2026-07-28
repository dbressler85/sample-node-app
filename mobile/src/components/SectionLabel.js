import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, size, space } from '../theme';
import { displayLabel } from '../typography';

// The one section-label treatment (docs/DESIGN_SYSTEM.md §4.4): the condensed Oswald face, uppercase,
// tracked, in structural VIOLET. Violet is the app's wayfinding law (§2.5b) — it names the labeling
// scaffolding that organizes a screen, so every section header reads as the same "here's a new part
// of the page" signal. Pass `style` for spacing overrides only — not for restyling the type/color.
export default function SectionLabel({ children, style }) {
  return <Text style={[styles.label, displayLabel(), style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: {
    color: colors.violetText,
    fontSize: size.caption,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: space.xl,
    marginBottom: space.sm,
  },
});
