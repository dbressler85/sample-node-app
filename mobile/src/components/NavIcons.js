import React from 'react';
import Svg, { Circle, Path, Line } from 'react-native-svg';

// Bottom-nav glyphs drawn as SVG so they take the active/inactive tint and stay crisp.
// Only the tabs that needed a real pictograph live here; the rest use unicode in TABS.

// Players — a person silhouette from the midsection up (head + shoulders), filled.
export function NavPersonIcon({ size = 20, color = '#fff' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="7" r="4" fill={color} />
      {/* Shoulders/upper torso rising into frame and cropped at the midsection. */}
      <Path d="M3.5 22 C3.5 16.4 7.3 13.5 12 13.5 C16.7 13.5 20.5 16.4 20.5 22 Z" fill={color} />
    </Svg>
  );
}

// Scores — an NFL goal post: a base post up to the crossbar, two uprights above it.
export function NavGoalPostIcon({ size = 20, color = '#fff' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Line x1="12" y1="22" x2="12" y2="12" />
      <Line x1="5" y1="12" x2="19" y2="12" />
      <Line x1="5" y1="12" x2="5" y2="3" />
      <Line x1="19" y1="12" x2="19" y2="3" />
    </Svg>
  );
}
