import React from 'react';
import Svg, { Circle, Path, Line, Polyline } from 'react-native-svg';

// One cohesive bottom-nav icon set: all outline (stroked) glyphs, same 24-viewBox, same
// stroke weight and round caps, so the six tabs read as a uniform family and take the
// active/inactive tint. Swapped in for the old mix of unicode glyphs + one filled icon.
const COMMON = { fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const Base = ({ size, color, children }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} {...COMMON}>{children}</Svg>
);

// Hub — a house.
export function NavHubIcon({ size = 22, color = '#fff' }) {
  return (
    <Base size={size} color={color}>
      <Path d="M3 11 L12 4 L21 11" />
      <Path d="M5.5 9.5 V20 H18.5 V9.5" />
      <Path d="M10 20 v-5 h4 v5" />
    </Base>
  );
}

// Players — a person (head + shoulders), stroked to match the set.
export function NavPersonIcon({ size = 22, color = '#fff' }) {
  return (
    <Base size={size} color={color}>
      <Circle cx="12" cy="8" r="3.4" />
      <Path d="M5.5 20 C5.5 15.6 8.4 13.5 12 13.5 C15.6 13.5 18.5 15.6 18.5 20" />
    </Base>
  );
}

// Trades — two arrows swapping (⇄).
export function NavTradesIcon({ size = 22, color = '#fff' }) {
  return (
    <Base size={size} color={color}>
      <Line x1="4" y1="9" x2="20" y2="9" />
      <Polyline points="17 6 20 9 17 12" />
      <Line x1="20" y1="15" x2="4" y2="15" />
      <Polyline points="7 12 4 15 7 18" />
    </Base>
  );
}

// Waivers — add (up) / drop (down) arrows.
export function NavWaiversIcon({ size = 22, color = '#fff' }) {
  return (
    <Base size={size} color={color}>
      <Line x1="8" y1="20" x2="8" y2="5" />
      <Polyline points="5 8 8 5 11 8" />
      <Line x1="16" y1="4" x2="16" y2="19" />
      <Polyline points="13 16 16 19 19 16" />
    </Base>
  );
}

// Lineups — a flag (set your starters).
export function NavLineupsIcon({ size = 22, color = '#fff' }) {
  return (
    <Base size={size} color={color}>
      <Line x1="6" y1="21" x2="6" y2="3" />
      <Path d="M6 4 H17 L14.2 7.5 L17 11 H6" />
    </Base>
  );
}

// Scores — an NFL goal post.
export function NavGoalPostIcon({ size = 22, color = '#fff' }) {
  return (
    <Base size={size} color={color}>
      <Line x1="12" y1="22" x2="12" y2="12" />
      <Line x1="5" y1="12" x2="19" y2="12" />
      <Line x1="5" y1="12" x2="5" y2="3" />
      <Line x1="19" y1="12" x2="19" y2="3" />
    </Base>
  );
}
