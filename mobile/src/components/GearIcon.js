import React from 'react';
import Svg, { G, Path, Circle } from 'react-native-svg';
import { colors } from '../theme';

// A real cog — eight teeth around a ringed hub — instead of the ⚙ text glyph, which
// rendered as a flat, off-weight character (and a color emoji on some Androids). Vector,
// so it stays crisp and takes the header's tint. Stroked, so it reads on any background.
export default function GearIcon({ size = 22, color = colors.textDim }) {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Thick, butt-capped radial nubs that overlap the rim read as cog teeth (the old
          thin round spokes read as a sunburst). */}
      <G stroke={color} strokeWidth={2.6} strokeLinecap="butt">
        {teeth.map((a) => (
          <Path key={a} d="M12 3 L12 6.4" transform={`rotate(${a} 12 12)`} />
        ))}
      </G>
      <Circle cx={12} cy={12} r={5.9} stroke={color} strokeWidth={2.3} fill="none" />
      <Circle cx={12} cy={12} r={2.3} stroke={color} strokeWidth={2} fill="none" />
    </Svg>
  );
}
