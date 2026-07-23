import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Line, G } from 'react-native-svg';
import { colors } from '../theme';

// The Dynasty Central mark — "The Regent Crest." A championship shield charged with the
// DC monogram as its centerpiece, crowned by a five-point coronet that sits squarely on
// the letters like a crown on a head, over gridiron hash-marks at the base. Dynasty
// (heraldry + crown) + command (many leagues, one crest) + the brand's initials.
//
// The crest is vector (crisp at any size, matches the app icon); the DC is a real text
// glyph overlaid and centered on the shield, so the letterforms are always sharp and
// correctly kerned rather than hand-traced paths.
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

        {/* coronet — a five-point crown sitting squarely (no tilt) atop the monogram like a
            crown on a head. Center point tallest and jewelled = your title team; the flanking
            points = your leagues. Pearl-tipped spikes rise from a decorated band with alternating
            gem settings for a fancier, more regal read. */}
        <G>
          {/* points (the jagged silhouette rising from the band) */}
          <Path
            d="M58 96 L64 68 L74 84 L82 56 L91 78 L100 44 L109 78 L118 56 L126 84 L136 68 L142 96 Z"
            fill="url(#dcGold)"
            stroke="#9C6E1C"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          {/* band */}
          <Rect x={56} y={92} width={88} height={13} rx={4} fill="url(#dcGoldBand)" stroke="#9C6E1C" strokeWidth={1} />
          {/* band gem settings */}
          <Circle cx={76} cy={98.5} r={3.2} fill="#5C9BFF" stroke="#2C4E86" strokeWidth={0.8} />
          <Circle cx={100} cy={98.5} r={3.6} fill="#E5544E" stroke="#7A241F" strokeWidth={0.8} />
          <Circle cx={124} cy={98.5} r={3.2} fill="#5C9BFF" stroke="#2C4E86" strokeWidth={0.8} />
          {/* pearl finials on each point tip */}
          <Circle cx={64} cy={68} r={4} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={82} cy={56} r={4.5} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={100} cy={44} r={6} fill="#FCE38F" stroke="#9C6E1C" strokeWidth={1} />
          <Circle cx={100} cy={44} r={2.4} fill="#E5544E" />
          <Circle cx={118} cy={56} r={4.5} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
          <Circle cx={136} cy={68} r={4} fill="#FFF6DA" stroke="#9C6E1C" strokeWidth={0.8} />
        </G>

        {/* gridiron hash-marks */}
        <G stroke="rgba(243,193,74,0.55)" strokeWidth={2.4} strokeLinecap="round">
          <Line x1={86} y1={186} x2={86} y2={195} />
          <Line x1={100} y1={184} x2={100} y2={197} />
          <Line x1={114} y1={186} x2={114} y2={195} />
        </G>
      </Svg>

      {/* DC monogram — real glyphs, enlarged to fill the shield field, centered below the
          crown. No roundel behind it; the letters are the charge. */}
      <View pointerEvents="none" style={styles.overlay}>
        <Text
          allowFontScaling={false}
          style={[styles.dc, { fontSize: Math.round(w * 0.42), transform: [{ translateY: (140 / 220 - 0.5) * h }] }]}
        >
          DC
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dc: {
    color: colors.goldLite,
    fontWeight: '900',
    // No trailing letter-spacing — it padded the right of "C" and shoved the pair
    // left of the shield's true center. The glyphs sit dead-center now.
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
