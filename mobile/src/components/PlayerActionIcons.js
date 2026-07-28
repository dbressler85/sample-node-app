import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, G } from 'react-native-svg';
import { glow } from '../theme';

// Matched vector icons for the three per-player actions, so Target / Avoid / Watch read
// as one control set wherever they appear. All stroke-based, tinted by `color`.
//
// Neon glow: when `glow` is set, each glyph draws a fat, low-opacity copy of itself BEHIND the crisp
// stroke — a shape-hugging halo that reads as a lit neon sign on BOTH platforms (pure SVG, unlike the
// iOS-only shadow halo). Used for the ACTIVE state so a set signal visibly glows.
function Halo({ glow: on, color, children }) {
  if (!on) return null;
  return (
    <G stroke={color} strokeOpacity={0.28} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {children}
    </G>
  );
}

// A round chip that lights with the neon glow recipe (docs/DESIGN_SYSTEM.md §3: edge + wash + iOS
// halo) when its action is ACTIVE, and is invisible otherwise — so a set Target/Avoid/Watch reads as
// a lit neon sign, not just a recolored glyph. `triplet` is the accent's "r,g,b" (theme.rgb.*). The
// base keeps a transparent 1px border so the box size never jumps between states.
export function GlowChip({ active, triplet, children }) {
  return (
    <View style={[styles.chip, active ? glow(triplet, { edge: 0.65, wash: 0.2, halo: 0.9, radius: 8 }) : null]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { padding: 4, borderRadius: 999, borderWidth: 1, borderColor: 'transparent' },
});

// Target — a crosshair reticule: a ring with four ticks that CROSS INTO the center toward a solid
// pip. The old version kept the ticks outside the ring, so at 18px it read as a plain green donut;
// crossing them inward + a bigger filled center makes it unmistakably a "locked-on target".
export function TargetIcon({ size = 20, color = '#5AD19A', glow: on = false }) {
  const reticule = (
    <>
      <Circle cx={12} cy={12} r={7.5} />
      <Line x1={12} y1={1.5} x2={12} y2={8.4} />
      <Line x1={12} y1={15.6} x2={12} y2={22.5} />
      <Line x1={1.5} y1={12} x2={8.4} y2={12} />
      <Line x1={15.6} y1={12} x2={22.5} y2={12} />
    </>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Halo glow={on} color={color}>{reticule}</Halo>
      {reticule}
      <Circle cx={12} cy={12} r={2.1} fill={color} stroke="none" />
    </Svg>
  );
}

// Avoid — a prohibition sign (circle with a slash).
export function AvoidIcon({ size = 20, color = '#F0603F', glow: on = false }) {
  const sign = (
    <>
      <Circle cx={12} cy={12} r={8} />
      <Line x1={6.3} y1={6.3} x2={17.7} y2={17.7} />
    </>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Halo glow={on} color={color}>{sign}</Halo>
      {sign}
    </Svg>
  );
}

// Watch — a star (filled when active).
export function WatchIcon({ size = 20, color = '#E8B84B', filled = false, glow: on = false }) {
  const d = 'M12 2.5 L14.6 9.2 L21.8 9.4 L16.1 13.8 L18.1 20.7 L12 16.6 L5.9 20.7 L7.9 13.8 L2.2 9.4 L9.4 9.2 Z';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {on ? <Path d={d} fill="none" stroke={color} strokeOpacity={0.28} strokeWidth={5} strokeLinejoin="round" /> : null}
      <Path d={d} fill={filled ? color : 'none'} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}
