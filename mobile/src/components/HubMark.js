import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Rect, Circle, Line, G } from 'react-native-svg';
import { colors } from '../theme';

// The Dynasty Central mark — "The Regent Crest." A championship shield topped by a
// coronet whose three points are your leagues (center gold = your title team), charged
// with a gold roundel medallion carrying the DC monogram, over gridiron hash-marks at
// the base. Dynasty (heraldry) + command (many leagues, one crest) + the brand's initials.
//
// The crest is vector (crisp at any size, matches the app icon); the DC is a real text
// glyph overlaid and centered on the roundel, so the letterforms are always sharp and
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

        {/* roundel medallion (the "head") — carries the DC monogram. Sits a touch above
            the shield's midline so the crown+roundel emblem reads centered, not bottom-heavy. */}
        <Circle cx={100} cy={120} r={38} fill="#0C1322" stroke="url(#dcGold)" strokeWidth={3} />
        <Circle cx={100} cy={120} r={30} fill="none" stroke="rgba(243,193,74,0.28)" strokeWidth={1.3} />

        {/* coronet — rests directly ON the roundel like a crown on a head, tipped a few
            degrees askew so it reads hand-set rather than stamped. Three points = your
            leagues, center jewel = your title team. Drawn after the roundel so it sits on
            top and clips a sliver of the rim. */}
        <G transform="rotate(-8 100 86)">
          <Rect x={64} y={80} width={72} height={9} rx={3} fill="url(#dcGold)" />
          <Path d="M64 82 L74 58 L88 72 L100 50 L112 72 L126 58 L136 82 Z" fill="url(#dcGold)" />
          <Circle cx={74} cy={58} r={5} fill="#5C9BFF" />
          <Circle cx={100} cy={50} r={6.5} fill="#FCE38F" stroke="#7A5A18" strokeWidth={1} />
          <Circle cx={126} cy={58} r={5} fill="#5C9BFF" />
        </G>

        {/* gridiron hash-marks */}
        <G stroke="rgba(243,193,74,0.55)" strokeWidth={2.4} strokeLinecap="round">
          <Line x1={86} y1={182} x2={86} y2={191} />
          <Line x1={100} y1={180} x2={100} y2={193} />
          <Line x1={114} y1={182} x2={114} y2={191} />
        </G>
      </Svg>

      {/* DC monogram — real glyphs, centered on the roundel (now at y≈120/220 of the height) */}
      <View pointerEvents="none" style={styles.overlay}>
        <Text
          allowFontScaling={false}
          style={[styles.dc, { fontSize: Math.round(w * 0.25), transform: [{ translateY: (120 / 220 - 0.5) * h }] }]}
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
    // left of the roundel's true center. The glyphs sit dead-center now.
    letterSpacing: 0,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
