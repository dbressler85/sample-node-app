import React from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

// Matched vector icons for the three per-player actions, so Target / Avoid / Watch read
// as one control set wherever they appear. All stroke-based, tinted by `color`.

// Target — a crosshair reticule.
export function TargetIcon({ size = 20, color = '#5AD19A' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={12} cy={12} r={7} />
      <Circle cx={12} cy={12} r={1.7} fill={color} stroke="none" />
      <Line x1={12} y1={1.5} x2={12} y2={5} />
      <Line x1={12} y1={19} x2={12} y2={22.5} />
      <Line x1={1.5} y1={12} x2={5} y2={12} />
      <Line x1={19} y1={12} x2={22.5} y2={12} />
    </Svg>
  );
}

// Avoid — a prohibition sign (circle with a slash).
export function AvoidIcon({ size = 20, color = '#F0603F' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={12} cy={12} r={8} />
      <Line x1={6.3} y1={6.3} x2={17.7} y2={17.7} />
    </Svg>
  );
}

// Watch — a star (filled when active).
export function WatchIcon({ size = 20, color = '#E8B84B', filled = false }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2.5 L14.6 9.2 L21.8 9.4 L16.1 13.8 L18.1 20.7 L12 16.6 L5.9 20.7 L7.9 13.8 L2.2 9.4 L9.4 9.2 Z"
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
