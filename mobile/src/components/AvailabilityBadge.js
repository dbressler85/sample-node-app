import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, size } from '../theme';

// Small colored pill for a player's game status. Renders nothing when ACTIVE.
const COLOR = {
  OUT: colors.bad,
  IR: colors.bad,
  INACTIVE: colors.bad,
  SUSPENDED: colors.bad,
  // A BYE is NOT an injury — red must keep meaning "he's out". Caution-orange, like QUESTIONABLE.
  BYE: colors.warn,
  DOUBTFUL: colors.warn,
  QUESTIONABLE: colors.warn,
};

export default function AvailabilityBadge({ availability, style }) {
  if (!availability || availability.status === 'ACTIVE' || !availability.label) return null;
  const c = COLOR[availability.status] || colors.textDim;
  return (
    <Text style={[styles.badge, { color: c, borderColor: c }, style]}>{availability.label}</Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    fontSize: size.micro,
    fontWeight: '800',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
