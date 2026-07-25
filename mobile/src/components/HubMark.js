import React from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Line, G, Text as SvgText } from 'react-native-svg';

// The Dynasty Central mark — "The Regent Crest." A championship shield charged with the DC monogram,
// crowned by a five-point coronet that sits DIRECTLY ON the letters like a crown on a head, over
// gridiron hash-marks at the base. Dynasty (heraldry + crown) + command (many leagues, one crest) +
// the brand's initials.
//
// The DC is a real glyph (react-native-svg <Text>) drawn INSIDE the SVG *before* the coronet, so the
// crown's band rests on the letters' cap-tops (the crown is painted on top). Everything is vector, so
// it's crisp at any size and matches the app icon, which is rendered from the same geometry.
export default function HubMark({ size = 88 }) {
  const w = size;
  const h = Math.round((size * 220) / 200); // crest is 200×220
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox="0 0 200 220">
        <Defs>
          <LinearGradient id="dcShield" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1A2440" />
            <Stop offset="1" stopColor="#0C1322" />
          </LinearGradient>
          <LinearGradient id="dcGold" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FCE38F" />
            <Stop offset="0.5" stopColor="#F3C14A" />
            <Stop offset="1" stopColor="#E3AE39" />
          </LinearGradient>
          <LinearGradient id="dcGoldBand" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF0B8" />
            <Stop offset="1" stopColor="#D89A2C" />
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

        {/* DC monogram — real glyph, drawn BEFORE the coronet so the crown sits on its cap-tops */}
        <SvgText
          x={100}
          y={160}
          textAnchor="middle"
          fontSize={82}
          fontWeight="900"
          letterSpacing={-8}
          fill="#FCE38F"
        >
          DC
        </SvgText>

        {/* coronet — a five-point crown with a STRAIGHT-bottom band that spans the full width of the
            monogram, its ends seated at the OUTER edges of the D and C and resting on the letters'
            cap-tops (a crown worn on the head). Geometry is measured off the real DC glyph box (band
            x 46.8→159, centered on the letters' ink center ~102.9), so the band always lines up with
            the letters. Center point tallest and jewelled = your title team; flanking points = leagues. */}
        <G>
          {/* points (the jagged silhouette rising from the band) */}
          <Path
            d="M46.8 94.3 L53.5 68.3 L65.3 96.3 L77.1 54.3 L90 96.3 L102.9 42.3 L115.8 96.3 L128.7 54.3 L140.5 96.3 L152.3 68.3 L159 94.3 Z"
            fill="url(#dcGold)"
            stroke="#9C6E1C"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          {/* band — straight bottom, full letter width */}
          <Rect x={46.8} y={94.3} width={112.2} height={13} rx={4} fill="url(#dcGoldBand)" stroke="#9C6E1C" strokeWidth={1} />
          {/* band gem settings (centered on the letters' ink center) */}
          <Circle cx={78.9} cy={100.8} r={3.2} fill="#5C9BFF" stroke="#2C4E86" strokeWidth={0.8} />
          <Circle cx={102.9} cy={100.8} r={3.6} fill="#E5544E" stroke="#7A241F" strokeWidth={0.8} />
          <Circle cx={126.9} cy={100.8} r={3.2} fill="#5C9BFF" stroke="#2C4E86" strokeWidth={0.8} />
          {/* pearl finials on each point tip */}
          <Circle cx={53.5} cy={68.3} r={4} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={77.1} cy={54.3} r={4.5} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={102.9} cy={42.3} r={6} fill="#FCE38F" stroke="#9C6E1C" strokeWidth={1} />
          <Circle cx={102.9} cy={42.3} r={2.4} fill="#E5544E" />
          <Circle cx={128.7} cy={54.3} r={4.5} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={152.3} cy={68.3} r={4} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
        </G>

        {/* gridiron hash-marks */}
        <G stroke="rgba(243,193,74,0.55)" strokeWidth={2.4} strokeLinecap="round">
          <Line x1={86} y1={186} x2={86} y2={195} />
          <Line x1={100} y1={184} x2={100} y2={197} />
          <Line x1={114} y1={186} x2={114} y2={195} />
        </G>
      </Svg>
    </View>
  );
}
