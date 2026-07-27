import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReducedMotion from './useReducedMotion';

// Pop-on-toggle (docs/MOTION_AND_NEON_ROADMAP.md §2.3 — Texture). Returns a scale Animated.Value that
// bumps (1 → 1.14 → 1, with a springy settle) the instant `active` transitions to TRUE, so a chip or
// segment visibly "pops" when it's selected. Only the newly-selected control pops — a chip going
// inactive stays put. Mirrors the other Texture hooks' honesty guards: it skips the first render (a
// control that mounts already-selected never pops) and reduce-motion (stays at 1).
export default function usePopScale(active) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  const prev = useRef(active);
  useEffect(() => {
    const became = active && !prev.current; // pop only on the false→true edge
    prev.current = active;
    if (first.current) { first.current = false; return undefined; }
    if (reduced || !became) return undefined;
    scale.setValue(1);
    const seq = Animated.sequence([
      Animated.timing(scale, { toValue: 1.14, duration: 90, useNativeDriver: true }), // snap up
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }), // settle
    ]);
    seq.start();
    return () => seq.stop();
  }, [active, reduced, scale]);
  return scale;
}
