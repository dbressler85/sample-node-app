import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, rgb, size, weight, radius, space } from '../theme';
import { useEntitlement } from '../entitlement';

// A tiny gold "PRO" pill screens drop next to a gated control so the free/Pro line is visible before a
// tap (the tap itself is gated via useRequirePro). Renders nothing when the user already has Pro OR while
// enforcement is off — so it never clutters the app until the paywall is actually live.
export default function ProLock({ style }) {
  const { isPro, enforced } = useEntitlement();
  if (isPro || !enforced) return null;
  return (
    <View style={[styles.pill, style]} accessibilityLabel="Pro feature">
      <Text style={styles.text}>PRO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: `rgba(${rgb.gold},0.16)`,
    borderWidth: 1,
    borderColor: `rgba(${rgb.gold},0.55)`,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  text: { color: colors.gold, fontSize: size.micro, fontWeight: '900', letterSpacing: 0.6 },
});
