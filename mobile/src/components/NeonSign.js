import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, Platform } from 'react-native';
import { NeonGlyph } from './NeonGlyphs';
import { color as neonColor, CORE, flickerPlan, ailingPlan } from '../neon';
import { displayLabel } from '../typography';
import useReducedMotion from '../useReducedMotion';

// A neon sign (docs/MOTION_AND_NEON_ROADMAP.md §3): a drawn glyph or a neon word, rendered as a lit
// tube (near-white core + colored bloom + an iOS halo). Two grades:
//   • grade="moment" → flickers ON like a real sign (§3.1) — reserved for real events (a trade, a win).
//   • grade="inline" → sits steady and fully lit — the everyday icons (watchlist, deadline, device).
//   • grade="ailing" → a PERPETUAL dying-tube flicker — for a persistent negative/empty state (empty
//     inbox, dead clock). Positive states stay steady; only "bad/nothing here" tubes sputter forever.
// tone="broken" is the deadpan sad flicker (reject/outbid/loss): a tube that never fully catches.
// Reduce-motion collapses any ignition to steady-and-fully-lit, honoring the never-strand guardrail.
//
// Give it EITHER `glyph` (a NeonGlyphs name) or `word` (neon text). `animateKey` re-fires a moment's
// ignition when it changes (e.g. a new celebration id); a fresh mount ignites once.

// Screen-reader phrases for the glyph family, so an unlabeled sign announces "trade" — not the raw
// token "swap". Unmapped glyphs fall through to no label (role="image"), never the internal name.
const GLYPH_LABELS = {
  swap: 'trade', waivers: 'waivers', bolt: 'live', check: 'done', bang: 'warning', info: 'info',
  star: 'watchlist', flag: 'lineup', cross: 'roster move', lock: 'locked', trophy: 'trophy',
  hourglass: 'deadline', tray: 'inbox', target: 'on the clock', dollar: 'value', tag: 'trade block',
  search: 'search', pause: 'paused', undo: 'counter', up: 'up', down: 'down', dot: 'live', calendar: 'scheduled',
};
export default function NeonSign({
  glyph,
  word,
  color = 'accent',
  size = 22,
  grade = 'inline',
  tone = 'clean',
  animateKey,
  style,
  accessibilityLabel,
}) {
  const reduced = useReducedMotion();
  const c = neonColor(color);
  const loops = grade === 'ailing';
  const plan = loops ? ailingPlan({ reduced }) : flickerPlan({ tone, reduced });
  // Inline signs are always steady; a moment sign ignites once; an ailing sign loops forever. All
  // collapse to the steady tube under reduce-motion.
  const ignites = (grade === 'moment' || loops) && !reduced && plan.frames.length > 0;
  const opacity = useRef(new Animated.Value(ignites && !loops ? 0 : plan.settled)).current;

  useEffect(() => {
    if (!ignites) {
      opacity.setValue(plan.settled); // steady / reduce-motion → snap to the settled tube
      return undefined;
    }
    opacity.setValue(loops ? plan.settled : 0); // moment lights from dark; ailing loops around its settle
    const seq = Animated.sequence(
      plan.frames.map((f) => Animated.timing(opacity, { toValue: f.to, duration: f.dur, useNativeDriver: true }))
    );
    const anim = loops ? Animated.loop(seq) : seq;
    anim.start();
    return () => anim.stop();
    // Re-ignite when the moment identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateKey, ignites, tone, loops]);

  // The iOS halo (glow recipe): a colored shadow around the tube. Android ignores shadow* with no
  // elevation set (never draws a grey box) — the bloom stroke + saturated core carry it there.
  const halo =
    Platform.OS === 'ios'
      ? { shadowColor: c.hex, shadowOpacity: 0.9, shadowRadius: Math.max(6, size * 0.5), shadowOffset: { width: 0, height: 0 } }
      : null;

  return (
    <Animated.View
      style={[styles.wrap, halo, { opacity }, style]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel || word || GLYPH_LABELS[glyph]}
    >
      {word ? (
        <Text
          style={[
            styles.word,
            displayLabel(),
            { fontSize: size, color: CORE, textShadowColor: c.hex, textShadowRadius: Math.max(6, size * 0.55) },
          ]}
        >
          {word}
        </Text>
      ) : (
        <NeonGlyph name={glyph} size={size} color={c.hex} core={CORE} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  word: {
    fontWeight: '800',
    letterSpacing: 1.5,
    textShadowOffset: { width: 0, height: 0 },
  },
});
