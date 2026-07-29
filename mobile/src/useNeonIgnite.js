import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { flickerPlan } from './neon';
import useReducedMotion from './useReducedMotion';

// Hold the sign dark for a beat AFTER the screen arrives, THEN flicker on — so the eye reaches the
// screen and registers "a title is about to light" before the ignition fires, instead of the flicker
// racing the transition and being missed.
const IGNITE_DELAY_MS = 340;

// Drives a screen heading's opacity so it "flickers on" like a neon sign when the screen gains focus
// — the Threshold register (docs/MOTION_AND_NEON_ROADMAP §3.1) applied to the title. Reuses the same
// tested `flickerPlan` the celebration signs use, so the ignition is byte-identical to the rest of the
// neon identity (and cross-platform: pure opacity).
//
// `focused` false→true re-ignites (return to a tab, an overlay uncovering); a fresh mount with
// focused=true ignites once. Reduce-motion settles fully-lit with NO flicker — honoring the
// "entrance defaults to the settled state, never strands/blanks" guardrail. Returns an Animated value
// to spread onto the title's `opacity` (wrap the heading in <Animated.Text>).
export default function useNeonIgnite(focused = true) {
  const reduced = useReducedMotion();
  const plan = flickerPlan({ tone: 'clean', reduced });
  const canIgnite = !reduced && plan.frames.length > 0;
  // Start dark only when we're actually going to flicker up from a focused mount; otherwise start lit.
  const opacity = useRef(new Animated.Value(canIgnite && focused ? 0 : plan.settled)).current;
  const litThisFocus = useRef(false); // have we already ignited for the current focus session?

  useEffect(() => {
    if (!focused) {
      litThisFocus.current = false; // reset so the NEXT focus re-ignites
      return undefined;
    }
    if (litThisFocus.current) return undefined; // already lit and still focused — don't re-flicker on unrelated renders
    litThisFocus.current = true;
    if (!canIgnite) {
      opacity.setValue(plan.settled); // reduce-motion (or empty plan): steady, fully on
      return undefined;
    }
    opacity.setValue(0);
    const seq = Animated.sequence([
      Animated.delay(IGNITE_DELAY_MS), // a beat off, so the eye arrives before the sign catches
      ...plan.frames.map((f) => Animated.timing(opacity, { toValue: f.to, duration: f.dur, useNativeDriver: true })),
    ]);
    seq.start();
    return () => seq.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, canIgnite]);

  return opacity;
}
