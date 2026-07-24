import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import { colors } from '../theme';

// The app's sense of humor, as an animation layer. A tiny global event bus lets any screen
// fire a moment without threading context: `celebrate('offerSent')`. One <CelebrationHost/>
// mounted at the app root plays it.
//
//   • happy events rain colorful confetti UP from the bottom corners and pop a caption.
//   • sad events drop a few grey flecks straight down and deliver a deadpan, ironic line —
//     the loss still stings, we just refuse to take it seriously.
let emit = null;
export function celebrate(key) { if (emit) emit(key); }

const HAPPY_COLORS = ['#F3C14A', '#5AD19A', '#4F8CFF', '#E8B84B', '#F0603F', '#B98CFF'];
const SAD_COLORS = ['#59647A', '#6C7A96', '#454F63'];

// Rotating copy per event. Happy is warm; sad is dry and a little smug on your behalf.
const EVENTS = {
  offerSent:     { mood: 'happy', emoji: '📨', lines: ['Offer’s in the wild.', 'Sent. Now we wait.', 'Pitch delivered.'] },
  tradeAccepted: { mood: 'happy', emoji: '🤝', lines: ['Deal! Everybody wins. Mostly you.', 'Trade accepted.', 'Shake on it.'] },
  claimPlaced:   { mood: 'happy', emoji: '📝', lines: ['Claim’s in!', 'Bid placed. Fingers crossed.'] },
  matchupWon:    { mood: 'happy', emoji: '🏆', lines: ['A W. As expected.', 'Victory. Screenshot it.'] },
  offerRejected: { mood: 'sad',   emoji: '🙅', lines: ['Rejected. Bold of them.', 'A no. Their loss, truly.', 'Denied. We’ll allow it.'] },
  offerWithdrawn:{ mood: 'sad',   emoji: '↩️', lines: ['Pulled it back.', 'Offer withdrawn.', 'Never mind, then.'] },
  claimFailed:   { mood: 'sad',   emoji: '📉', lines: ['Outbid. Someone wanted him more. Rude.', 'Denied by the waiver gods.'] },
  matchupLost:   { mood: 'sad',   emoji: '💀', lines: ['An L. Character-building.', 'You lost. Statistically, someone had to.'] },
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function CelebrationHost() {
  const [event, setEvent] = useState(null); // { mood, emoji, line, id }
  useEffect(() => {
    emit = (key) => {
      const e = EVENTS[key];
      if (!e) return;
      setEvent({ mood: e.mood, emoji: e.emoji, line: pick(e.lines), id: `${Date.now()}-${Math.random()}` });
    };
    return () => { emit = null; };
  }, []);
  if (!event) return null;
  return <Burst key={event.id} event={event} onDone={() => setEvent(null)} />;
}

const { width: W, height: H } = Dimensions.get('window');

function Burst({ event, onDone }) {
  const happy = event.mood === 'happy';
  const flecks = useRef(
    Array.from({ length: happy ? 28 : 7 }, (_, i) => {
      // happy: launch from the two bottom corners; sad: drizzle from the top-center.
      const fromLeft = i % 2 === 0;
      const x0 = happy
        ? (fromLeft ? 0.12 : 0.88) * W + (Math.random() - 0.5) * 70
        : W * (0.32 + Math.random() * 0.36);
      const startY = happy ? H * 0.9 : -24;
      const travel = happy ? -(H * (0.45 + Math.random() * 0.42)) : H * (0.32 + Math.random() * 0.24);
      return {
        p: new Animated.Value(0),
        x0,
        startY,
        endY: startY + travel,
        driftX: happy ? (fromLeft ? 1 : -1) * (30 + Math.random() * 150) : (Math.random() - 0.5) * 50,
        spin: (Math.random() - 0.5) * 6,
        color: happy ? pick(HAPPY_COLORS) : pick(SAD_COLORS),
        size: happy ? 7 + Math.random() * 7 : 8 + Math.random() * 4,
        delay: Math.random() * (happy ? 200 : 140),
        round: Math.random() < 0.4,
      };
    })
  ).current;
  const cap = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      ...flecks.map((f) =>
        Animated.timing(f.p, {
          toValue: 1,
          duration: happy ? 1500 : 1700,
          delay: f.delay,
          easing: happy ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
          useNativeDriver: true,
        })
      ),
      Animated.sequence([
        Animated.spring(cap, { toValue: 1, useNativeDriver: true, friction: 6, tension: 90 }),
        Animated.delay(1000),
        Animated.timing(cap, { toValue: 0, duration: 320, useNativeDriver: true }),
      ]),
    ]).start(() => onDone && onDone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {flecks.map((f, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: f.x0,
            top: 0,
            width: f.size,
            height: f.size,
            borderRadius: f.round ? f.size / 2 : 1.5,
            backgroundColor: f.color,
            opacity: f.p.interpolate({ inputRange: [0, 0.72, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: f.p.interpolate({ inputRange: [0, 1], outputRange: [f.startY, f.endY] }) },
              { translateX: f.p.interpolate({ inputRange: [0, 1], outputRange: [0, f.driftX] }) },
              { rotate: f.p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${f.spin * 180}deg`] }) },
            ],
          }}
        />
      ))}
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
        <Text style={styles.capEmoji}>{event.emoji}</Text>
        <Text style={[styles.capText, !happy && styles.capSad]}>{event.line}</Text>
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
  capEmoji: { fontSize: 40, marginBottom: 6 },
  capText: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  capSad: { color: colors.textDim, fontStyle: 'italic', fontWeight: '700' },
});
