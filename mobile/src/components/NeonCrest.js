import React, { useEffect, useRef } from 'react';
import { View, Animated, Platform, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Circle, Line, G } from 'react-native-svg';
import { flickerPlan, planDuration } from '../neon';
import useReducedMotion from '../useReducedMotion';

// The Regent Crest as a NEON sign (docs/MOTION_AND_NEON_ROADMAP.md §2.1 / §3) — the code home of the
// approved "Neon Crest — Two-Tone × Gem-Lit" direction. The whole crest is lit tube: gold shield +
// crown + hash, Signal-Blue DC monogram, lit jewels. Two states, one component:
//   • unlit — colored but DULL, desaturated glass, no glow (the resting frame the login opens on).
//   • lit   — bright cores + colored bloom + an iOS halo (the in-app resting state + the login lockup).
// `ignited` flips between them; when it does (and motion is allowed) the sign FLICKERS on/off like a
// real neon sign — off→false-starts→catch→bloom→settle (§3.1). Reduce-motion snaps to the target
// state (never strands/blanks). RN can't do CSS blur, so bloom = a wide colored underlay stroke under
// a near-white core (the glow recipe's cross-platform half) + an iOS halo on the lit layer.
//
// Geometry is the exact approved artifact: C terminals curl to vertical (corners matched to the left),
// charge scaled 0.9 and re-centered on the shield's x=100 centerline.

const CHARGE = 'translate(100,104) scale(0.9) translate(-102.9,-104)'; // shrink + recenter the DC+crown+gems

const CORE = { gold: '#FFF1C6', blue: '#DCE8FF', red: '#FFD9D6', finial: '#FFFDF4' };
const HUE = { gold: '#F3C14A', blue: '#4F8CFF', red: '#E5544E' };
const DULL = { gold: '#7C6A3C', blue: '#455572', gemBlue: '#47597E', gemRed: '#7C4C48', finial: '#6E6952' };
const SHIELD_FILL = { lit: 'rgba(9,14,26,0.5)', off: 'rgba(12,16,26,0.5)' };

const P = {
  shield: 'M100 14 C66 28 44 32 28 34 L28 112 C28 164 62 196 100 210 C138 196 172 164 172 112 L172 34 C156 32 134 28 100 14 Z',
  hair: 'M100 26 C70 37 51 41 38 43 L38 110 C38 156 67 184 100 197 C133 184 162 156 162 110 L162 43 C149 41 130 37 100 26 Z',
  d: 'M58 116 L80 116 Q100 116 100 144 Q100 172 80 172 L58 172 Q50 172 50 164 L50 124 Q50 116 58 116 Z',
  c: 'M154 132 L154 130 Q154 116 140 116 L120 116 Q106 116 106 130 L106 158 Q106 172 120 172 L140 172 Q154 172 154 158 L154 156',
  // Crown zigzag lifted 5 up (was …94.3/96.3 valleys) so its points clear the band's top edge (y=94.3)
  // instead of dipping into it.
  crown: 'M46.8 89.3 L53.5 63.3 L65.3 91.3 L77.1 49.3 L90 91.3 L102.9 37.3 L115.8 91.3 L128.7 49.3 L140.5 91.3 L152.3 63.3 L159 89.3 Z',
};
const FINIALS = [[53.5, 63.3, 4], [77.1, 49.3, 4.5], [102.9, 37.3, 6], [128.7, 49.3, 4.5], [152.3, 63.3, 4]];
const GEMS = [[78.9, 100.8, 3.4, 'blue'], [102.9, 100.8, 3.8, 'red'], [126.9, 100.8, 3.4, 'blue']];
const HASH = [[86, 186, 86, 195], [100, 184, 100, 197], [114, 186, 114, 195]];

// The wall-clock of the crest's ignition, so the login can time its fly-out to start as the sign catches.
export const CREST_IGNITE_MS = planDuration(flickerPlan({ tone: 'clean' }));

// A tube: a lit tube is a wide colored bloom under a near-white core; an unlit tube is one dull stroke.
function tubeProps(lit, hueKey, w = 3.4) {
  return { hue: lit ? HUE[hueKey] : DULL[hueKey], core: lit ? CORE[hueKey] : null, w };
}
function Tube({ d, lit, hueKey, w = 3.4, fill = 'none' }) {
  const { hue, core } = tubeProps(lit, hueKey, w);
  return (
    <>
      {lit ? <Path d={d} stroke={hue} strokeOpacity={0.5} strokeWidth={w + 4.5} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
      <Path d={d} stroke={lit ? core : hue} strokeWidth={w} fill={fill} strokeLinejoin="round" strokeLinecap="round" />
    </>
  );
}

// One full crest, drawn either lit or unlit. Two of these stack (unlit base + lit overlay) so the
// ignition is a pure opacity crossfade over the always-present unlit glass.
function Crest({ lit }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 200 220">
      {/* shield: dark fill + gold tube */}
      <Path d={P.shield} fill={lit ? SHIELD_FILL.lit : SHIELD_FILL.off} />
      <Tube d={P.shield} lit={lit} hueKey="gold" />
      {lit ? <Path d={P.hair} stroke={HUE.gold} strokeOpacity={0.4} strokeWidth={1.2} fill="none" /> : null}

      {/* charge — DC + crown + gems, shrunk + centered together */}
      <G transform={CHARGE}>
        <Tube d={P.d} lit={lit} hueKey="blue" />
        <Tube d={P.c} lit={lit} hueKey="blue" />

        <Tube d={P.crown} lit={lit} hueKey="gold" />
        {/* band — stroked gold tube rect */}
        {lit ? <Rect x={46.8} y={94.3} width={112.2} height={13} rx={6} stroke={HUE.gold} strokeOpacity={0.5} strokeWidth={7.9} fill="none" /> : null}
        <Rect x={46.8} y={94.3} width={112.2} height={13} rx={6} stroke={lit ? CORE.gold : DULL.gold} strokeWidth={3.4} fill="none" />
        {FINIALS.map(([cx, cy, r], i) => (
          <Circle key={`f${i}`} cx={cx} cy={cy} r={r} fill={lit ? CORE.finial : DULL.finial} />
        ))}

        {GEMS.map(([cx, cy, r, kind], i) => (
          <Circle key={`g${i}`} cx={cx} cy={cy} r={r} fill={lit ? CORE[kind] : kind === 'red' ? DULL.gemRed : DULL.gemBlue} />
        ))}
      </G>

      {/* gridiron hash */}
      {HASH.map(([x1, y1, x2, y2], i) => (
        <Line key={`h${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={lit ? CORE.gold : DULL.gold} strokeWidth={2.4} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

export default function NeonCrest({ size = 104, ignited = true, animate = true }) {
  const reduced = useReducedMotion();
  const h = Math.round((size * 220) / 200);
  const lit = useRef(new Animated.Value(ignited ? 1 : 0)).current;
  const first = useRef(true);

  useEffect(() => {
    // A fresh mount SNAPS to its state — a crest that just appeared never flickers on its own; only a
    // later change to `ignited` runs the ceremony (login ignites, logout extinguishes).
    if (first.current) {
      first.current = false;
      lit.setValue(ignited ? 1 : 0);
      return undefined;
    }
    if (reduced || !animate) {
      lit.setValue(ignited ? 1 : 0); // snap — no flicker
      return undefined;
    }
    let seq;
    if (ignited) {
      // Ignite: off → false-starts → catch → bloom → steady (the shared neon flicker plan).
      const plan = flickerPlan({ tone: 'clean' });
      lit.setValue(0);
      seq = Animated.sequence(plan.frames.map((f) => Animated.timing(lit, { toValue: f.to, duration: f.dur, useNativeDriver: true })));
    } else {
      // Extinguish: a quick stutter down to dark — the mirror the logout plays.
      seq = Animated.sequence([
        Animated.timing(lit, { toValue: 0.6, duration: 60, useNativeDriver: true }),
        Animated.timing(lit, { toValue: 0.12, duration: 55, useNativeDriver: true }),
        Animated.timing(lit, { toValue: 0.4, duration: 50, useNativeDriver: true }),
        Animated.timing(lit, { toValue: 0, duration: 190, useNativeDriver: true }),
      ]);
    }
    seq.start();
    return () => seq.stop();
  }, [ignited, reduced, animate, lit]);

  const halo =
    Platform.OS === 'ios'
      ? { shadowColor: HUE.gold, shadowOpacity: 0.6, shadowRadius: Math.max(8, size * 0.14), shadowOffset: { width: 0, height: 0 } }
      : null;

  return (
    <View style={{ width: size, height: h }}>
      {/* unlit glass, always present underneath */}
      <View style={StyleSheet.absoluteFill}><Crest lit={false} /></View>
      {/* lit sign fades/flickers in over it */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: lit }, halo]}>
        <Crest lit />
      </Animated.View>
    </View>
  );
}
