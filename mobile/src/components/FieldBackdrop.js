import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Line, G } from 'react-native-svg';

// A quiet, on-brand backdrop for dark screens: a deep navy vertical gradient, a soft
// championship-gold glow up top (where the crest sits), and faint gridiron yard-lines.
// Drawn in a 0–100 square stretched to fill (preserveAspectRatio none), so it adapts to
// any container without measuring. Purely decorative — never intercepts touches.
export default function FieldBackdrop({ glow = true }) {
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none" pointerEvents="none">
      <Defs>
        <LinearGradient id="fbBase" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0B1224" />
          <Stop offset="0.55" stopColor="#080B15" />
          <Stop offset="1" stopColor="#05070E" />
        </LinearGradient>
        <RadialGradient id="fbGlow" cx="0.5" cy="0.26" r="0.62">
          <Stop offset="0" stopColor="#F3C14A" stopOpacity="0.13" />
          <Stop offset="1" stopColor="#F3C14A" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#fbBase)" />
      {glow ? <Rect x="0" y="0" width="100" height="100" fill="url(#fbGlow)" /> : null}
      {/* faint yard-lines */}
      <G stroke="rgba(255,255,255,0.035)" strokeWidth="0.35">
        {[16, 30, 44, 58, 72, 86].map((y) => (
          <Line key={y} x1="0" y1={y} x2="100" y2={y} />
        ))}
      </G>
    </Svg>
  );
}
