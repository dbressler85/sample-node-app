import React from 'react';
import { View, StyleSheet } from 'react-native';

// SVG-FREE backdrop. A full-screen react-native-svg surface at the app root was the prime
// suspect for the native launch crash (it paints the instant the app opens — the "navy
// flash then crash"), and a native SVG crash can't be caught by a JS error boundary. This
// version uses only plain Views: a deep-navy base with a few translucent gold bands up top
// to fake the gold→navy glow. Not a true gradient, but it carries the look with zero native
// SVG risk. If the app now launches, the backdrop SVG was the culprit and we can bring back
// a smooth gradient via a static image (still no SVG) next.
export default function FieldBackdrop({ hero = false }) {
  const g = (a) => `rgba(243,193,74,${a})`;
  return (
    <View style={[StyleSheet.absoluteFill, styles.base]} pointerEvents="none">
      <View style={[styles.band, { top: 0, height: '16%', backgroundColor: g(hero ? 0.5 : 0.16) }]} />
      <View style={[styles.band, { top: '12%', height: '14%', backgroundColor: g(hero ? 0.3 : 0.09) }]} />
      <View style={[styles.band, { top: '22%', height: '16%', backgroundColor: g(hero ? 0.16 : 0.04) }]} />
      <View style={[styles.band, { top: '34%', height: '14%', backgroundColor: g(hero ? 0.07 : 0.015) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: '#0A0F1C' },
  band: { position: 'absolute', left: 0, right: 0 },
});
