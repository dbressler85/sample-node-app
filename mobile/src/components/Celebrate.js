import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, AccessibilityInfo } from 'react-native';
import { colors } from '../theme';
import { signFor, planDuration, flickerPlan } from '../neon';
import NeonSign from './NeonSign';
import NeonSparks from './NeonSparks';
import useReducedMotion from '../useReducedMotion';
import haptics from '../haptics';

// The app's sense of humor, as a neon Punctuation layer (docs/MOTION_AND_NEON_ROADMAP.md §3). A tiny
// global event bus lets any screen fire a moment without threading context: `celebrate('offerSent')`.
// One <CelebrationHost/> mounted at the app root plays it: a neon SIGN flickers on (§3.7), neon SPARKS
// burst (§3.5 — confetti retired), and a deadpan caption pops.
//
//   • happy events: a clean sign catches + a bright spark fan + a warm line.
//   • sad events: the broken-sign flicker (a tube that never fully settles) + a sparse, dim shower +
//     a dry, ironic line — the loss still stings, we just refuse to take it seriously.
let emit = null;
export function celebrate(key) { if (emit) emit(key); }

// Rotating copy per event. Happy is warm; sad is dry and a little smug on your behalf. The neon sign
// + spark mood come from neon.signFor(key) (docs §3.7); this only owns the words.
const LINES = {
  offerSent: ['Offer’s in the wild.', 'Sent. Now we wait.', 'Pitch delivered.'],
  tradeAccepted: ['Deal! Everybody wins. Mostly you.', 'Trade accepted.', 'Shake on it.'],
  claimPlaced: ['Claim’s in!', 'Bid placed. Fingers crossed.'],
  matchupWon: ['A W. As expected.', 'Victory. Screenshot it.'],
  offerRejected: ['Rejected. Bold of them.', 'What were they thinking?', 'Denied. We’ll allow it.'],
  offerWithdrawn: ['Pulled it back.', 'Offer withdrawn.', 'Never mind, then.'],
  claimFailed: ['Outbid. Someone wanted him more. Rude.', 'Denied by the waiver gods.'],
  matchupLost: ['An L. Character-building.', 'You lost. Statistically, someone had to.'],
};

const MOODS = { clean: 'happy', hero: 'happy', cold: 'sad' };

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function CelebrationHost() {
  const [event, setEvent] = useState(null); // { key, sign, line, id }
  useEffect(() => {
    emit = (key) => {
      const sign = signFor(key);
      const lines = LINES[key];
      if (!sign || !lines) return;
      // A physical beat on every celebrated moment: success for the happy signs, a softer warning
      // buzz for the sad ones (a lost matchup / outbid claim still stings).
      (MOODS[sign.spark] === 'happy' ? haptics.success : haptics.warning)();
      const line = pick(lines);
      // A celebration is a neon+haptic PUNCTUATION beat — invisible to a screen reader without this.
      // Announce the line politely so VoiceOver/TalkBack users get the same "it landed" acknowledgement.
      try { AccessibilityInfo.announceForAccessibility(line); } catch (e) { /* best-effort */ }
      setEvent({ key, sign, line, id: `${Date.now()}-${Math.random()}` });
    };
    return () => { emit = null; };
  }, []);
  if (!event) return null;
  return <Burst key={event.id} event={event} onDone={() => setEvent(null)} />;
}

function Burst({ event, onDone }) {
  const { sign, line, id } = event;
  const happy = MOODS[sign.spark] === 'happy';
  const cap = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      // Reduce-motion: no sparks, no flicker — the sign shows steady + the line delivers, then dismiss.
      cap.setValue(1);
      const t = setTimeout(() => onDone && onDone(), 1600);
      return () => clearTimeout(t);
    }
    // Let the sign finish igniting before the caption pops, so the moment reads as sign-then-word.
    const ignite = planDuration(flickerPlan({ tone: sign.tone }));
    const anim = Animated.sequence([
      Animated.delay(Math.max(120, ignite - 120)),
      Animated.spring(cap, { toValue: 1, useNativeDriver: true, friction: 6, tension: 90 }),
      Animated.delay(1000),
      Animated.timing(cap, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]);
    anim.start(() => onDone && onDone());
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {!reduced ? <NeonSparks mood={sign.spark} /> : null}
      <Animated.View
        style={[
          styles.capWrap,
          {
            opacity: cap,
            transform: [
              { scale: cap.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
              { translateY: cap.interpolate({ inputRange: [0, 1], outputRange: happy ? [12, 0] : [-10, 0] }) },
            ],
          },
        ]}
      >
        <View style={styles.signWrap}>
          <NeonSign
            glyph={sign.sign}
            word={sign.word}
            color={sign.color}
            tone={sign.tone}
            grade="moment"
            animateKey={id}
            size={sign.word ? 34 : 46}
            accessibilityLabel={sign.word || sign.sign}
          />
        </View>
        <Text style={[styles.capText, !happy && styles.capSad]}>{line}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  capWrap: {
    position: 'absolute',
    top: '38%',
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(10,15,28,0.92)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 22,
    paddingVertical: 16,
    maxWidth: '82%',
  },
  signWrap: { height: 52, justifyContent: 'center', marginBottom: 6 },
  capText: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  capSad: { color: colors.textDim, fontStyle: 'italic', fontWeight: '700' },
});
