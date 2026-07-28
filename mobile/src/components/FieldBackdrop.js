import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Line, G } from 'react-native-svg';
import NeonCrest from './NeonCrest';

// Ambient watermark size — a fixed fraction of the screen (this crest sits behind content and never
// needs to reflow, so one measure at module load is enough).
const WM_SIZE = Math.round(Dimensions.get('window').width * 0.72);

// The app-wide backdrop: faint gridiron yard-lines and a ghosted crest watermark over one of two
// grounds. Gold now means VALUE (docs/DESIGN_SYSTEM.md §1), so it can't also be the wallpaper —
// the ambient ground is therefore gold-free:
//   • hero  (login) — a bold band of clear gold at the very top melting into deep navy. This is
//                     ceremony, not wallpaper (the threshold + the crest ignition), so gold stays.
//   • ambient (app) — "Deep Ink": a near-flat dark navy that lifts slightly at center so cards
//                     float, with an edge vignette and NO gold. Makes value-gold + the neon tier pop.
// The ground is deliberately a clean navy: violet is no longer wallpaper — it now names the app's
// structural label layer (see theme.js `violet`), so the backdrop stays out of its way.
// Drawn in a 0–100 square stretched to fill (preserveAspectRatio none) so it adapts to any
// container without measuring. Purely decorative — never intercepts touches.
// Memoized: props are stable (the app renders it with none, login with a fixed `hero`), so the
// heavy static SVG shouldn't re-render on every unrelated App state change (tab/overlay/etc.).
function FieldBackdrop({ hero = false, watermark = true }) {
  const ambient = !hero;
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
        {ambient ? <Rect x="0" y="0" width="100" height="100" fill="url(#fbVignette)" /> : null}
        {/* faint yard-lines */}
        <G stroke="rgba(255,255,255,0.03)" strokeWidth="0.35">
          {[16, 30, 44, 58, 72, 86].map((y) => (
            <Line key={y} x1="0" y1={y} x2="100" y2={y} />
          ))}
        </G>
      </Svg>

      {/* Ghosted crest watermark — the neon Regent Crest in its UNLIT state (dull, desaturated glass,
          no glow), held at very low opacity. A powered-down sign in the wall: present and on-brand,
          but quiet enough to sit behind content and never leak championship gold as decoration (the
          color law). The lit crest stays exclusive to the login lockup + ignition. */}
      {watermark ? (
        <View style={styles.wmWrap}>
          <View style={styles.wmImg}>
            <NeonCrest size={WM_SIZE} ignited={false} animate={false} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centered vertically, biased up into the content area (the tab bar eats the bottom, so
  // true screen-center reads low). paddingBottom pulls the crest above the mathematical middle.
  wmWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingBottom: '14%' },
  wmImg: { opacity: 0.13 },
});

export default React.memo(FieldBackdrop);
