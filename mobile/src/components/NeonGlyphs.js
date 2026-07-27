import React from 'react';
import Svg, { Path } from 'react-native-svg';

// The neon glyph set (docs/MOTION_AND_NEON_ROADMAP.md §3.7). Each glyph is drawn as a TUBE: a wide,
// colored bloom stroke underneath + a thin near-white core on top — the layered-stroke half of the
// glow recipe that reads as "lit neon" on both platforms (the iOS halo is added by NeonSign's
// container shadow). Pure vector, tinted by props; no per-glyph color literals.

// One glyph = a set of SVG path `d` strings, stroked twice (bloom under, core over).
const PATHS = {
  x: ['M6 6 L18 18', 'M18 6 L6 18'],
  check: ['M4.5 12.5 L9.5 17.5 L19.5 6.5'],
  // A trophy: cup bowl, two handles, stem, base.
  trophy: [
    'M8 4 H16 V8 A4 4 0 0 1 8 8 Z',
    'M8 5 H5.5 V6.5 A2.5 2.5 0 0 0 8 9',
    'M16 5 H18.5 V6.5 A2.5 2.5 0 0 1 16 9',
    'M12 12 V16',
    'M8.5 20 H15.5',
    'M12 16 L12 20',
  ],
  // Counter-clockwise undo arrow.
  undo: ['M8.5 6 L5 9 L8.5 12', 'M5.5 9 H14 A4.5 4.5 0 0 1 14 18 H9.5'],
  down: ['M12 4 V17.5', 'M6.5 12 L12 19 L17.5 12'],
  // Star (the watchlist sign).
  star: ['M12 2.6 L14.55 9.1 L21.5 9.35 L15.95 13.7 L17.9 20.5 L12 16.5 L6.1 20.5 L8.05 13.7 L2.5 9.35 L9.45 9.1 Z'],
  // Hourglass (deadline).
  hourglass: ['M6 4 H18', 'M6 20 H18', 'M7.5 4 L12 12 L7.5 20', 'M16.5 4 L12 12 L16.5 20'],
  // Inbox tray.
  tray: ['M4.5 13 H8 L9.6 15.5 H14.4 L16 13 H19.5', 'M4.5 13 L7.2 5.5 H16.8 L19.5 13 V19 H4.5 Z'],
  // Two swapping arrows.
  swap: ['M6 9 H17.5', 'M14.5 6 L18 9 L14.5 12', 'M18 15 H6.5', 'M9.5 12 L6 15 L9.5 18'],
  // Lightning bolt (device / live read).
  bolt: ['M13 3 L6 13 H11 L11 21 L18 11 H13 Z'],
  // Crosshair target (a draft on the clock / scheduled).
  target: ['M5 12 A7 7 0 1 1 19 12 A7 7 0 1 1 5 12', 'M12 2.5 V6', 'M12 18 V21.5', 'M2.5 12 H6', 'M18 12 H21.5'],
  // Pennant flag (a lineup lock).
  flag: ['M7 3 V21', 'M7 4 H18 L14.5 8 L18 12 H7'],
  // Medical cross (an illegal-IR roster move).
  cross: ['M12 5 V19', 'M5 12 H19'],
  // Warning bang (a lineup we couldn't verify).
  bang: ['M12 4 L21 20 H3 Z', 'M12 10 V15', 'M12 17.6 V17.9'],
};

const NAMES = Object.keys(PATHS);

// Draw one glyph. `color` is the bloom hue, `core` the hot near-white filament. The bloom stroke is
// wider and slightly translucent so the color reads as glow around the crisp white core.
export function NeonGlyph({ name, size = 22, color = '#4F8CFF', core = '#F6FBFF' }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* bloom underlay */}
      {d.map((p, i) => (
        <Path key={`b${i}`} d={p} stroke={color} strokeOpacity={0.9} strokeWidth={4.2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {/* white tube core */}
      {d.map((p, i) => (
        <Path key={`c${i}`} d={p} stroke={core} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

export { NAMES };
