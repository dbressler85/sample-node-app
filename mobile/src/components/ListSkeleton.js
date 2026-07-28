import React from 'react';
import { View, StyleSheet } from 'react-native';
import Skeleton from './Skeleton';
import { colors, space, radius, size } from '../theme';

// A list-shaped loading placeholder (docs/DESIGN_SYSTEM.md §10) — a stack of card rows, each a
// title bar + a shorter subtitle bar, so a first load reads as "content arriving" instead of a
// lone spinner on a blank screen. `rows` sets how many; `style` lets the caller pad it like a list.
export default function ListSkeleton({ rows = 6, style }) {
  return (
    <View style={[styles.wrap, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.card}>
          <Skeleton w={26} h={26} r={radius.pill} />
          <View style={styles.lines}>
            <Skeleton w={`${70 - (i % 3) * 12}%`} h={size.bodyLg} />
            <Skeleton w={`${44 + (i % 4) * 8}%`} h={size.caption} style={{ marginTop: space.sm }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingTop: space.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.sm,
  },
  lines: { flex: 1, marginLeft: space.md },
});
