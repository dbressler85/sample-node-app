import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { colors, size as sizes, weight } from '../theme';

// A compact donut for a small part-to-whole set (team outlook mix). Segments are drawn as dashed
// circle strokes (no arc-path math), rotated to start at 12 o'clock, with a 3px surface gap between
// them (the dataviz spacer) so adjacent slices never merge. Colour is NEVER the only cue — every
// segment is named + counted in the legend the caller renders beside it. Center shows a headline.
export default function OutlookDonut({ segments, size = 128, stroke = 18, centerTop, centerBottom }) {
  const cx = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const total = (segments || []).reduce((s, x) => s + (x.value || 0), 0);
  const GAP = total > 0 ? 3 : 0;
  let accum = 0;
  const arcs = [];
  if (total > 0) {
    for (const seg of segments) {
      if (!seg.value) continue;
      const frac = seg.value / total;
      const len = Math.max(0.001, frac * circ - GAP);
      arcs.push(
        <Circle
          key={seg.key}
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={seg.color}
          strokeWidth={stroke}
          strokeDasharray={`${len} ${circ - len}`}
          strokeDashoffset={-accum}
          strokeLinecap="butt"
        />
      );
      accum += frac * circ;
    }
  }
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${cx}, ${cx}`}>
          <Circle cx={cx} cy={cx} r={r} fill="none" stroke={colors.border} strokeWidth={stroke} opacity={0.6} />
          {arcs}
        </G>
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        {centerTop != null ? <Text style={styles.top}>{centerTop}</Text> : null}
        {centerBottom != null ? <Text style={styles.bottom}>{centerBottom}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { color: colors.text, fontSize: sizes.hero, fontWeight: '900' },
  bottom: { color: colors.textDim, fontSize: sizes.micro, fontWeight: weight.bold, marginTop: 1 },
});
