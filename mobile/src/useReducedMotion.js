import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Whether the OS "reduce motion" accessibility setting is on. Motion primitives read this to snap to
// their settled state instead of animating (docs/DESIGN_SYSTEM.md §8 / MOTION_AND_NEON_ROADMAP.md).
// Reads once on mount and subscribes to changes. Defaults to false (motion on) — a detection failure
// or unsupported platform never over-restricts, matching the "never strand/blank" guardrail: a skipped
// animation must always leave content at its final visible state, so `false` is the safe default.
export default function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (alive) setReduced(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReduced(!!v));
    return () => {
      alive = false;
      // RN returns a subscription with .remove() on modern versions; guard for older shapes.
      if (sub && typeof sub.remove === 'function') sub.remove();
    };
  }, []);
  return reduced;
}
