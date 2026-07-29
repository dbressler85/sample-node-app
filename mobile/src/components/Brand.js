import React from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';
import { displayXL, displayLg } from '../typography';
import useNeonIgnite from '../useNeonIgnite';

// Shared "broadcast" treatment so the flair stays consistent in one place.
// ScreenTitle: condensed, uppercase, tracked — the lower-third look, in the bundled Oswald display
// face (falls back to the system face until it loads), under a short violet rule. Title + rule are
// BOTH the STRUCTURE law (theme.js `violet`/`violetText`): violet names the app's labeling/wayfinding
// layer, and the screen heading is the top of it — so the heading itself is violet and marks "you are
// here." It IGNITES with the neon flicker when the screen gains focus (`focused` prop → useNeonIgnite),
// so arriving on a screen lights its sign; reduce-motion settles it steady. Value stays gold (below).
export function ScreenTitle({ children, style, focused = true }) {
  const opacity = useNeonIgnite(focused);
  return (
    <View style={styles.titleWrap}>
      <Animated.Text style={[styles.title, displayXL(), { opacity }, style]}>{children}</Animated.Text>
      <View style={styles.titleRule} />
    </View>
  );
}

// The overlay/pushed-screen heading (the centered topbar title, e.g. "Portfolio", a league name, a
// player name). Same structure-law violet + neon ignite-on-focus as ScreenTitle, but without the
// left-aligned rule — it drops into an existing back-button topbar row. Owns the color/glow/ignite in
// ONE place so the treatment can be tuned centrally. `focused` re-ignites (default true → ignite on
// mount, which is the moment a pushed screen "comes into focus").
export function TopbarTitle({ children, focused = true, numberOfLines, style }) {
  const opacity = useNeonIgnite(focused);
  return (
    <Animated.Text style={[styles.topbarTitle, displayLg(), { opacity }, style]} numberOfLines={numberOfLines}>
      {children}
    </Animated.Text>
  );
}

export function Value({ children, size = 22, color = colors.gold, style }) {
  return <Text style={[styles.value, { fontSize: size, color }, style]}>{children}</Text>;
}

// A faint gold crest ghosted into a header — quiet texture that ties every screen
// to the same franchise. Position it absolutely in the header container.
export function CrestWatermark({ size = 190, style }) {
  return (
    <Svg width={size} height={Math.round(size * 1.1)} viewBox="0 0 200 220" style={[styles.wm, style]}>
      <Path
        d="M100 14 C66 28 44 32 28 34 L28 112 C28 164 62 196 100 210 C138 196 172 164 172 112 L172 34 C156 32 134 28 100 14 Z"
        fill="none"
        stroke={colors.gold}
        strokeWidth={4}
      />
      <Path d="M56 132 L68 78 L86 106 L100 66 L114 106 L132 78 L144 132 Z" fill={colors.gold} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  titleWrap: { alignSelf: 'flex-start' },
  // Violet heading = the top of the structure/wayfinding layer (color law §1). A soft violet text-glow
  // gives it the lit-neon feel to match the ignition; kept subtle so the uppercase title stays legible.
  title: {
    color: colors.violetText,
    fontSize: 27,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    textShadowColor: 'rgba(139,92,246,1)',
    textShadowRadius: 23,
    textShadowOffset: { width: 0, height: 0 },
  },
  // Short violet accent rule under each screen title — the structural-wayfinding mark (not an action):
  // wider and brighter with a soft violet halo, so the "you are here" cue reads as intentional.
  titleRule: {
    height: 4,
    width: 46,
    borderRadius: 2,
    backgroundColor: colors.violet,
    marginTop: 6,
    shadowColor: colors.violet,
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  // Overlay heading: violet (structure) + soft violet glow to match the ignite, sized like the topbar
  // titles it replaces (fontSize 20 / heavy). Screens may pass `style` to nudge size where needed.
  topbarTitle: { color: colors.violetText, fontSize: 20, fontWeight: '900', textShadowColor: 'rgba(139,92,246,0.9)', textShadowRadius: 14, textShadowOffset: { width: 0, height: 0 } },
  value: { fontWeight: '900', color: colors.gold, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  wm: { position: 'absolute', right: -34, top: -26, opacity: 0.05 },
});
