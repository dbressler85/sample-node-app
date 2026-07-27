import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReducedMotion from './useReducedMotion';

// Acted-on flash (docs/MOTION_AND_NEON_ROADMAP.md §2.3 — Texture). When `trigger` changes, pulse a
// value 0→1→0 so a row or control can wash its accent to acknowledge that an action landed on IT
// (a tag set, a claim placed, a block toggled), then settle — the action visibly lands on the list
// instead of silently mutating.
//
// Two guards keep it honest in a virtualized list: it SKIPS the first run (a freshly-mounted or
// scrolled-in row never flashes) and reduce-motion (no pulse). Because FlatList rows are keyed by id,
// `trigger` only changes when THIS row's own state changes — not when the list re-sorts or scrolls.
// Returns an Animated.Value in [0,1]; interpolate it to an overlay opacity.
export default function useActFlash(trigger) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false; // a fresh mount / scroll-in is not an action — don't flash
      return undefined;
    }
    if (reduced) return undefined;
    v.setValue(0);
    const seq = Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 120, useNativeDriver: true }), // snap the wash on
      Animated.timing(v, { toValue: 0, duration: 520, useNativeDriver: true }), // …then settle
    ]);
    seq.start();
    return () => seq.stop();
  }, [trigger, reduced, v]);
  return v;
}
