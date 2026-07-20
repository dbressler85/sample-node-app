import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Line, G, Path, Circle } from 'react-native-svg';

// The app-wide backdrop: a championship gold-to-navy gradient, faint gridiron yard-lines,
// and a large, ghosted crest watermark. Two intensities share one look:
//   • hero  (login) — a bold band of clear gold at the very top melting down into deep
//                     navy. Dramatic, because the login content is vertically centered so
//                     the gold sits behind empty space and the crest, never behind text.
//   • ambient (app) — a navy field lit by a soft gold glow up top, so header text stays
//                     readable while the whole app still reads gold-over-navy.
// Drawn in a 0–100 square stretched to fill (preserveAspectRatio none) so it adapts to any
// container without measuring. Purely decorative — never intercepts touches.
export default function FieldBackdrop({ hero = false, watermark = true }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          {/* hero — clear gold at the crown of the screen, dramatic fall to navy */}
          <LinearGradient id="fbHero" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F8CB53" />
            <Stop offset="0.07" stopColor="#E3B245" />
            <Stop offset="0.16" stopColor="#93712F" />
            <Stop offset="0.30" stopColor="#33344C" />
            <Stop offset="0.50" stopColor="#17223E" />
            <Stop offset="0.75" stopColor="#0B1121" />
            <Stop offset="1" stopColor="#05070E" />
          </LinearGradient>
          {/* ambient — navy field for content screens */}
          <LinearGradient id="fbBase" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#111C34" />
            <Stop offset="0.5" stopColor="#0A1120" />
            <Stop offset="1" stopColor="#05070E" />
          </LinearGradient>
          {/* soft gold glow up top (drives the ambient gold, absent in hero) */}
          <RadialGradient id="fbGlow" cx="0.5" cy="0.14" r="0.72">
            <Stop offset="0" stopColor="#F3C14A" stopOpacity={hero ? '0' : '0.34'} />
            <Stop offset="1" stopColor="#F3C14A" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={hero ? 'url(#fbHero)' : 'url(#fbBase)'} />
        <Rect x="0" y="0" width="100" height="100" fill="url(#fbGlow)" />
        {/* faint yard-lines */}
        <G stroke="rgba(255,255,255,0.03)" strokeWidth="0.35">
          {[16, 30, 44, 58, 72, 86].map((y) => (
            <Line key={y} x1="0" y1={y} x2="100" y2={y} />
          ))}
        </G>
      </Svg>

      {/* Ghosted crest watermark — aspect-preserved and centered so it never squishes.
          The viewBox pads the 200×220 crest into a larger frame so the mark reads small. */}
      {watermark ? (
        <Svg style={StyleSheet.absoluteFill} viewBox="-110 -80 420 480" preserveAspectRatio="xMidYMid meet">
          <G opacity={0.055} stroke="#F3C14A" strokeWidth="2.5" fill="none" strokeLinejoin="round">
            <Path d="M100 14 C66 28 44 32 28 34 L28 112 C28 164 62 196 100 210 C138 196 172 164 172 112 L172 34 C156 32 134 28 100 14 Z" />
            <Circle cx="100" cy="132" r="38" />
            <Path d="M64 96 L74 72 L88 86 L100 64 L112 86 L126 72 L136 96 Z" />
          </G>
        </Svg>
      ) : null}
    </View>
  );
}
