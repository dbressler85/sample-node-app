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
      <G stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {teeth.map((a) => (
          <Path key={a} d="M12 2.4 L12 5" transform={`rotate(${a} 12 12)`} />
        ))}
        <Circle cx={12} cy={12} r={6.4} />
        <Circle cx={12} cy={12} r={2.5} />
      </G>
    </Svg>
  );
}
