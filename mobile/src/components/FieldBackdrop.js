import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Line, G } from 'react-native-svg';

// The app-wide backdrop: faint gridiron yard-lines and a ghosted crest watermark over one of two
// grounds. Gold now means VALUE (docs/DESIGN_SYSTEM.md §1), so it can't also be the wallpaper —
// the ambient ground is therefore gold-free:
//   • hero  (login) — a bold band of clear gold at the very top melting into deep navy. This is
//                     ceremony, not wallpaper (the threshold + the crest ignition), so gold stays.
//   • ambient (app) — "Deep Ink": a near-flat dark navy that lifts slightly at center so cards
//                     float, with an edge vignette and NO gold. Makes value-gold + the neon tier pop.
//                     (Exploratory — trying Deep Ink on device; see the background-options study.)
// Drawn in a 0–100 square stretched to fill (preserveAspectRatio none) so it adapts to any
// container without measuring. Purely decorative — never intercepts touches.
// Memoized: props are stable (the app renders it with none, login with a fixed `hero`), so the
// heavy static SVG shouldn't re-render on every unrelated App state change (tab/overlay/etc.).
function FieldBackdrop({ hero = false, watermark = true }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          {/* hero — clear gold at the crown of the screen, dramatic fall to navy (login only) */}
          <LinearGradient id="fbHero" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F8CB53" />
            <Stop offset="0.07" stopColor="#E3B245" />
            <Stop offset="0.16" stopColor="#93712F" />
            <Stop offset="0.30" stopColor="#33344C" />
            <Stop offset="0.50" stopColor="#17223E" />
            <Stop offset="0.75" stopColor="#0B1121" />
            <Stop offset="1" stopColor="#05070E" />
          </LinearGradient>
          {/* ambient "Deep Ink" — near-flat dark navy that lifts slightly at center (cards float) */}
          <RadialGradient id="fbInk" cx="0.5" cy="0.4" r="0.9">
            <Stop offset="0" stopColor="#0F1930" />
            <Stop offset="0.72" stopColor="#080D1A" />
            <Stop offset="1" stopColor="#05070E" />
          </RadialGradient>
          {/* edge vignette so the corners fall away and the content floats (ambient only) */}
          <RadialGradient id="fbVignette" cx="0.5" cy="0.42" r="0.75">
            <Stop offset="0.55" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.5" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={hero ? 'url(#fbHero)' : 'url(#fbInk)'} />
        {hero ? null : <Rect x="0" y="0" width="100" height="100" fill="url(#fbVignette)" />}
        {/* faint yard-lines */}
        <G stroke="rgba(255,255,255,0.03)" strokeWidth="0.35">
          {[16, 30, 44, 58, 72, 86].map((y) => (
            <Line key={y} x1="0" y1={y} x2="100" y2={y} />
          ))}
        </G>
      </Svg>

      {/* Ghosted crest watermark — the REAL app crest, not a hand-drawn stand-in. It's
          the transparent adaptive-icon, so the navy shield body melts into the navy field
          and only the gold rim, crown, and DC monogram ghost through. Sits high, behind
          the gold glow, aspect-preserved so it never squishes. */}
      {watermark ? (
        <View style={styles.wmWrap}>
          <Image
            source={require('../../assets/adaptive-icon.png')}
            style={styles.wmImg}
            resizeMode="contain"
            fadeDuration={0}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centered vertically, biased up into the content area (the tab bar eats the bottom, so
  // true screen-center reads low). paddingBottom pulls the crest above the mathematical middle.
  wmWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingBottom: '14%' },
  wmImg: { width: '74%', aspectRatio: 1, opacity: 0.06 },
});

export default React.memo(FieldBackdrop);
