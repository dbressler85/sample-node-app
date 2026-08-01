// Neon-sign logic — the pure, dependency-free half of the Punctuation register
// (docs/MOTION_AND_NEON_ROADMAP.md §3). No react-native import, so it's safe to unit-test under
// `node --test` exactly like theme.js. The RN component (components/NeonSign.js) turns the flicker
// PLAN this produces into an Animated.sequence and draws the tube; the tone/color/glyph decisions
// and the "how a real sign turns on" keyframes live here where they can be asserted.
const { colors, rgb } = require('./theme');

// Color keys → { hex core-adjacent accent, triplet for the glow recipe }. Derived from the theme
// tokens (colors + rgb) so the palette has ONE source and can't fork — the medal hues (gold/silver/
// bronze) used to be hard-coded in both files. theme.js is dependency-free (no RN import), so this
// stays safe to unit-test under `node --test`. `cold` is theme's muted blue-grey (textDim), the
// deadpan sad tube (withdraw / loss) — lit, never celebratory; `white` is a neon-only tube, brighter
// than body text, for the beta bug-report sign.
const tube = (hex, triplet) => ({ hex, rgb: triplet });
const COLORS = {
  accent: tube(colors.accent, rgb.accent),
  good: tube(colors.good, rgb.good),
  bad: tube(colors.bad, rgb.bad),
  gold: tube(colors.gold, rgb.gold),
  silver: tube(colors.silver, rgb.silver), // podium runner-up medal (trophy case)
  bronze: tube(colors.bronze, rgb.bronze), // podium 3rd-place medal (trophy case)
  warn: tube(colors.warn, rgb.warn),
  watch: tube(colors.watch, rgb.watch),
  cold: tube(colors.textDim, rgb.textDim),
  white: tube('#EAF1FF', '234,241,255'), // a white tube — the beta bug-report sign (flickers)
};
// The near-white tube CORE every neon sign shares — the hot inner filament the color blooms around.
const CORE = '#F6FBFF';

function color(key) {
  return COLORS[key] || COLORS.accent;
}

// The celebration bus events (components/Celebrate.js) → their neon sign (docs §3.7). `sign` is a
// drawn glyph; `word` is neon text (a sign is glowing text, so a word is as on-brand as a glyph).
// `spark` = the burst mood: 'hero' (gold, biggest), 'clean' (accent/good), or 'cold' (sad, sparse+dim).
const EVENT_SIGNS = {
  offerSent: { word: 'SENT', color: 'accent', tone: 'clean', spark: 'clean' },
  tradeAccepted: { sign: 'check', color: 'good', tone: 'clean', spark: 'clean' },
  claimPlaced: { word: 'BID IN', color: 'accent', tone: 'clean', spark: 'clean' },
  matchupWon: { sign: 'trophy', color: 'gold', tone: 'clean', spark: 'hero' },
  offerRejected: { sign: 'x', color: 'bad', tone: 'broken', spark: 'cold' },
  offerWithdrawn: { sign: 'undo', color: 'cold', tone: 'clean', spark: 'cold' },
  claimFailed: { word: 'OUTBID', color: 'bad', tone: 'broken', spark: 'cold' },
  matchupLost: { word: 'L', color: 'cold', tone: 'broken', spark: 'cold' },
};

function signFor(key) {
  return EVENT_SIGNS[key] || null;
}

// The flicker-on plan (docs §3.1): a list of opacity keyframes {to,dur} an Animated.sequence walks.
// A clean sign does a couple of false-starts → catches → blooms to full → settles steady at 1. A
// broken sign (sad/reject/outbid) stutters and never fully catches — it settles a touch under full,
// one segment forever not quite lighting. Pure opacity, so it's byte-identical on iOS and Android
// (§3.6). Reduce-motion collapses the whole thing to a single fully-lit frame: no flicker, steady and
// on — honoring the "entrance defaults to settled state, never strands/blanks" guardrail.
function flickerPlan({ tone = 'clean', reduced = false } = {}) {
  if (reduced) return { settled: 1, frames: [] };
  if (tone === 'broken') {
    const settled = 0.82; // a tube that won't fully catch — deadpan, on purpose
    return {
      settled,
      frames: [
        { to: 0, dur: 0 },
        { to: 0.6, dur: 45 },
        { to: 0.0, dur: 70 },
        { to: 0.85, dur: 35 },
        { to: 0.12, dur: 80 },
        { to: 0.55, dur: 60 },
        { to: 0.22, dur: 70 },
        { to: 0.78, dur: 50 },
        { to: 0.45, dur: 110 },
        { to: settled, dur: 90 },
      ],
    };
  }
  // clean
  return {
    settled: 1,
    frames: [
      { to: 0, dur: 0 },
      { to: 0.78, dur: 50 }, // first false-start flick
      { to: 0.06, dur: 60 }, // …drops back out
      { to: 0.92, dur: 45 }, // second flick
      { to: 0.12, dur: 55 }, // …drops
      { to: 1, dur: 70 }, // catch → bloom to full
      { to: 0.82, dur: 55 }, // brief settle dip (the overshoot easing back)
      { to: 1, dur: 140 }, // steady hum
    ],
  };
}

// The flicker-OUT plan: tapping an already-lit sign "off". A real tube doesn't cut clean — it gives a
// last gasp and sputters down to dark. Ends at 0 (fully extinguished). The mirror of flickerPlan for a
// toggle going off. Reduce-motion snaps straight to off (never strands a half-lit tube).
function extinguishPlan({ reduced = false } = {}) {
  if (reduced) return { settled: 0, frames: [] };
  return {
    settled: 0,
    frames: [
      { to: 0.5, dur: 40 }, // dips
      { to: 0.9, dur: 35 }, // a last gasp brightens
      { to: 0.12, dur: 55 }, // drops hard
      { to: 0.34, dur: 35 }, // faint after-flicker
      { to: 0, dur: 80 }, // out
    ],
  };
}

// A PERPETUAL dying-tube loop (docs §3): for a persistent negative/empty state (an empty inbox, a
// dead clock), the sign sits mostly-lit and keeps sputtering — never fully catching, never fully
// dying. The frames start and end at the same value so Animated.loop has no visible seam. Reduce-motion
// collapses to the steady under-lit tube (never strands).
function ailingPlan({ reduced = false } = {}) {
  const settled = 0.82;
  if (reduced) return { settled, frames: [] };
  return {
    settled,
    frames: [
      { to: settled, dur: 1100 }, // holds mostly-lit for a beat...
      { to: 0.92, dur: 55 }, //       a small surge
      { to: 0.24, dur: 60 }, //       ...then a sputter down
      { to: 0.68, dur: 45 },
      { to: 0.16, dur: 80 }, //       nearly out
      { to: 0.6, dur: 50 },
      { to: settled, dur: 150 }, //   recover to the start value → seamless loop
    ],
  };
}

// Total wall-clock of a plan (ms) — the host uses it to know when a moment is done.
function planDuration(plan) {
  return (plan.frames || []).reduce((s, f) => s + (f.dur || 0), 0);
}

// Spark burst config per mood (docs §3.5 — confetti retired, wins throw neon sparks in the accent
// palette; sad moments get a sparse, dim shower). Kept as data so the burst is tunable + testable.
const SPARKS = {
  hero: { count: 26, colors: ['gold', 'good', 'accent', 'watch'], up: true, spread: 1 },
  clean: { count: 18, colors: ['accent', 'good'], up: true, spread: 0.9 },
  cold: { count: 7, colors: ['cold'], up: false, spread: 0.5 },
};

function sparkSpec(mood) {
  return SPARKS[mood] || SPARKS.clean;
}

module.exports = {
  COLORS,
  CORE,
  color,
  EVENT_SIGNS,
  signFor,
  flickerPlan,
  extinguishPlan,
  ailingPlan,
  planDuration,
  SPARKS,
  sparkSpec,
};
