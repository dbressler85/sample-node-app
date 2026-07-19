import React from 'react';
import { View } from 'react-native';
import { colors } from '../theme';

// The Dynasty Central mark — "many leagues, one hub." A central command hub with
// leagues orbiting it, one in championship gold. Built from plain Views so it
// needs no SVG dependency. Layout is defined against an 88px reference box and
// scaled to `size`.
export default function HubMark({ size = 88 }) {
  const s = size / 88;
  const node = (left, top, color, d = 11) => ({
    position: 'absolute',
    left: left * s,
    top: top * s,
    width: d * s,
    height: d * s,
    borderRadius: (d / 2) * s,
    backgroundColor: color,
  });
  return (
    <View style={{ width: size, height: size }}>
      {/* orbit ring */}
      <View style={{ position: 'absolute', left: 12 * s, top: 12 * s, width: 64 * s, height: 64 * s, borderRadius: 32 * s, borderWidth: 1.5, borderColor: colors.border }} />
      {/* orbiting leagues (top node is the championship, in gold) */}
      <View style={node(38.5, 6.5, colors.gold)} />
      <View style={node(66.2, 22.5, '#5C9BFF')} />
      <View style={node(66.2, 54.5, '#5C9BFF')} />
      <View style={node(38.5, 70.5, '#5C9BFF')} />
      <View style={node(10.8, 54.5, '#5C9BFF')} />
      <View style={node(10.8, 22.5, '#5C9BFF')} />
      {/* central command hub */}
      <View style={{ position: 'absolute', left: 31 * s, top: 31 * s, width: 26 * s, height: 26 * s, borderRadius: 13 * s, backgroundColor: colors.accent }} />
      <View style={{ position: 'absolute', left: 40 * s, top: 40 * s, width: 8 * s, height: 8 * s, borderRadius: 4 * s, backgroundColor: '#EAF2FF' }} />
    </View>
  );
}
