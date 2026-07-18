import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

// Small colored pill for a player's game status. Renders nothing when ACTIVE.
const COLOR = {
  OUT: colors.bad,
  IR: colors.bad,
  INACTIVE: colors.bad,
  SUSPENDED: colors.bad,
  BYE: colors.bad,
  DOUBTFUL: '#ff9d5c',
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
    fontSize: 10,
    fontWeight: '800',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
