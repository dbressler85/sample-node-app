import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, size, space } from '../theme';
import { displayLabel } from '../typography';

// The one section-label treatment (docs/DESIGN_SYSTEM.md §4.4): the condensed Oswald face, uppercase,
// tracked, dim. Replaces the 4+ divergent section headings across screens. Pass `style` for spacing
// overrides only — not for restyling the type.
export default function SectionLabel({ children, style }) {
  return <Text style={[styles.label, displayLabel(), style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: {
    color: colors.textDim,
    fontSize: size.caption,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: space.xl,
    marginBottom: space.sm,
  },
});
