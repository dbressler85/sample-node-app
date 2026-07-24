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
          y={172}
          textAnchor="middle"
          fontSize={82}
          fontWeight="900"
          letterSpacing={-2}
          fill="#FCE38F"
        >
          DC
        </SvgText>

        {/* coronet — a five-point crown resting squarely ON the monogram like a crown on a head.
            Center point tallest and jewelled = your title team; the flanking points = your leagues.
            Pearl-tipped spikes rise from a decorated band with alternating gem settings. */}
        <G>
          {/* points (the jagged silhouette rising from the band) */}
          <Path
            d="M58 107 L64 79 L74 95 L82 67 L91 89 L100 55 L109 89 L118 67 L126 95 L136 79 L142 107 Z"
            fill="url(#dcGold)"
            stroke="#9C6E1C"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          {/* band */}
          <Rect x={56} y={103} width={88} height={13} rx={4} fill="url(#dcGoldBand)" stroke="#9C6E1C" strokeWidth={1} />
          {/* band gem settings */}
          <Circle cx={76} cy={109.5} r={3.2} fill="#5C9BFF" stroke="#2C4E86" strokeWidth={0.8} />
          <Circle cx={100} cy={109.5} r={3.6} fill="#E5544E" stroke="#7A241F" strokeWidth={0.8} />
          <Circle cx={124} cy={109.5} r={3.2} fill="#5C9BFF" stroke="#2C4E86" strokeWidth={0.8} />
          {/* pearl finials on each point tip */}
          <Circle cx={64} cy={79} r={4} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={82} cy={67} r={4.5} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={100} cy={55} r={6} fill="#FCE38F" stroke="#9C6E1C" strokeWidth={1} />
          <Circle cx={100} cy={55} r={2.4} fill="#E5544E" />
          <Circle cx={118} cy={67} r={4.5} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={136} cy={79} r={4} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
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
