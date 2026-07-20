import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Line, G } from 'react-native-svg';

// The Dynasty Central mark — "The Regent Crest." A championship crest whose crown
// points ARE your leagues (the center one gold = your title team), with gridiron
// hash-marks at the base. Dynasty (heraldry) + command (many leagues, one crest).
// Drawn as vector so it's crisp at any size and matches the app icon.
export default function HubMark({ size = 88 }) {
  const w = size;
  const h = Math.round((size * 220) / 200); // crest is 200×220
  return (
    <Svg width={w} height={h} viewBox="0 0 200 220">
      <Defs>
        <LinearGradient id="dcShield" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1A2440" />
          <Stop offset="1" stopColor="#0C1322" />
        </LinearGradient>
        <LinearGradient id="dcGold" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FCE38F" />
          <Stop offset="1" stopColor="#E3AE39" />
        </LinearGradient>
      </Defs>
      {/* shield */}
      <Path
        d="M100 14 C66 28 44 32 28 34 L28 112 C28 164 62 196 100 210 C138 196 172 164 172 112 L172 34 C156 32 134 28 100 14 Z"
        fill="url(#dcShield)"
        stroke="url(#dcGold)"
        strokeWidth={3}
      />
      {/* inner engraving hairline */}
      <Path
        d="M100 26 C70 37 51 41 38 43 L38 110 C38 156 67 184 100 197 C133 184 162 156 162 110 L162 43 C149 41 130 37 100 26 Z"
        fill="none"
        stroke="rgba(243,193,74,0.22)"
        strokeWidth={1.4}
      />
      {/* crown */}
      <Path d="M56 132 L68 78 L86 106 L100 66 L114 106 L132 78 L144 132 Z" fill="url(#dcGold)" />
      <Rect x={56} y={130} width={88} height={13} rx={3.5} fill="url(#dcGold)" />
      {/* crown-point nodes = your leagues; center point = championship gold */}
      <Circle cx={68} cy={78} r={6.5} fill="#5C9BFF" />
      <Circle cx={100} cy={65} r={8} fill="#FCE38F" stroke="#7A5A18" strokeWidth={1} />
      <Circle cx={132} cy={78} r={6.5} fill="#5C9BFF" />
      {/* gridiron hash-marks */}
      <G stroke="rgba(243,193,74,0.55)" strokeWidth={2.4} strokeLinecap="round">
        <Line x1={84} y1={158} x2={84} y2={167} />
        <Line x1={100} y1={156} x2={100} y2={169} />
        <Line x1={116} y1={158} x2={116} y2={167} />
      </G>
    </Svg>
  );
}
