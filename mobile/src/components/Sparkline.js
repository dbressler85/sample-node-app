import React from 'react';
import Svg, { Polyline, Polygon, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors } from '../theme';

// A compact value-over-time line with a soft area fill and an emphasized endpoint — the
// "is my portfolio up or down" glance. Drawn 1:1 (viewBox matches pixel size) so the endpoint
// dot stays round. Pass the numeric series; needs at least two points to render.
export default function Sparkline({ data, width = 300, height = 64, color = colors.gold, strokeWidth = 2 }) {
  const pts = (data || []).filter((v) => typeof v === 'number');
  if (pts.length < 2) return null;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = strokeWidth + 2;
  const stepX = (width - pad * 2) / (pts.length - 1);
  const x = (i) => pad + i * stepX;
  const y = (v) => pad + (height - pad * 2) * (1 - (v - min) / span);

  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${height} ${line} ${x(pts.length - 1).toFixed(1)},${height}`;
  const lastX = x(pts.length - 1);
  const lastY = y(pts[pts.length - 1]);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.26" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Polygon points={area} fill="url(#sparkFill)" />
      <Polyline points={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={lastX} cy={lastY} r={strokeWidth + 1.5} fill={color} />
    </Svg>
  );
}
