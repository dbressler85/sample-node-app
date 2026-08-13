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
  // Waivers: two VERTICAL arrows (one up, one down) — matches the nav bar's waivers icon.
  waivers: ['M8.5 20 V5', 'M5.5 8 L8.5 5 L11.5 8', 'M15.5 4 V19', 'M12.5 16 L15.5 19 L18.5 16'],
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
  // A circled lower-case "i" — the missing `info` member of the family (InfoDot + the toast's info tone
  // used the bare ⓘ glyph before). Circle + a short stem + a dot cap above it.
  info: ['M4 12 A8 8 0 1 1 20 12 A8 8 0 1 1 4 12', 'M12 11 V16.4', 'M12 7.4 V7.7'],
  // Padlock (waivers locked): body + shackle + keyhole.
  lock: ['M6.5 10.5 H17.5 V19.5 H6.5 Z', 'M8.5 10.5 V8 A3.5 3.5 0 0 1 15.5 8 V10.5', 'M12 13.8 V16.2'],
  // A ring dot (free agency open / draft live — a lit "go" light). Two half-arcs so it closes cleanly.
  dot: ['M12 8 A4 4 0 1 1 12 16 A4 4 0 1 1 12 8'],
  // Calendar (draft not started / seasonal marker): frame, header divider, two binding legs.
  calendar: ['M5 6 H19 V19 H5 Z', 'M5 9.5 H19', 'M8.5 4 V7', 'M15.5 4 V7'],
  // Dollar sign (value / market): an S-curve with a vertical bar through it.
  dollar: ['M15.5 8 C15.5 5.6 13.6 4.5 12 4.5 C9.8 4.5 8.5 5.9 8.5 7.7 C8.5 9.5 10.2 10.3 12 10.8 C13.8 11.3 15.5 12.2 15.5 14.1 C15.5 16 14.1 17.5 12 17.5 C10.2 17.5 8.5 16.5 8.5 14', 'M12 2.5 V19.5'],
  // Price tag (trade block): a tag body + its punch hole.
  tag: ['M12.5 4 H20 V11.5 L11.5 20 L4 12.5 Z', 'M16.4 6.9 A1.2 1.2 0 1 1 16.4 9.3 A1.2 1.2 0 1 1 16.4 6.9'],
  // Magnifying glass (search / find): lens + handle.
  search: ['M10.5 5 A5.5 5.5 0 1 1 10.5 16 A5.5 5.5 0 1 1 10.5 5', 'M14.6 14.6 L20 20'],
  // Pause (draft clock paused): two vertical bars.
  pause: ['M9 5 V19', 'M15 5 V19'],
  // Person (profile): head + shoulders.
  person: ['M12 4 A3.1 3.1 0 1 1 12 10.2 A3.1 3.1 0 1 1 12 4', 'M5.5 20 C5.5 15.6 8.4 13 12 13 C15.6 13 18.5 15.6 18.5 20'],
  // Gear (settings): center hole + ring + eight teeth.
  settings: [
    'M9.6 12 A2.4 2.4 0 1 1 14.4 12 A2.4 2.4 0 1 1 9.6 12',
    'M6.6 12 A5.4 5.4 0 1 1 17.4 12 A5.4 5.4 0 1 1 6.6 12',
    'M12 3.6 V6.4', 'M12 17.6 V20.4', 'M3.6 12 H6.4', 'M17.6 12 H20.4',
    'M6.1 6.1 L8.1 8.1', 'M15.9 15.9 L17.9 17.9', 'M17.9 6.1 L15.9 8.1', 'M8.1 15.9 L6.1 17.9',
  ],
  // Bug (report a bug): rounded body + head, antennae, center seam, three legs a side.
  bug: [
    'M12 7 C15 7 16.4 10 16.4 14 C16.4 18 14.4 20 12 20 C9.6 20 7.6 18 7.6 14 C7.6 10 9 7 12 7 Z',
    'M10.2 5.4 A1.8 1.8 0 1 1 13.8 5.4 A1.8 1.8 0 1 1 10.2 5.4',
    'M10.9 4.2 L9.2 2.6', 'M13.1 4.2 L14.8 2.6',
    'M12 8 V19',
    'M7.8 11 L4.6 9.6', 'M7.5 14.4 L4.2 14.4', 'M7.8 17.8 L4.6 19.4',
    'M16.2 11 L19.4 9.6', 'M16.5 14.4 L19.8 14.4', 'M16.2 17.8 L19.4 19.4',
  ],
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

// A PLAIN single-color glyph (no neon bloom) — for functional UI chrome that either sits ON a colored
// fill (a checkbox tick on the accent square) or just needs a crisp legible mark at small sizes, where
// the two-layer tube would muddy. Same path family as NeonGlyph, one solid stroke.
export function GlyphMark({ name, size = 16, color = '#FFFFFF', weight = 2.2 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {d.map((p, i) => (
        <Path key={i} d={p} stroke={color} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

export { NAMES };
