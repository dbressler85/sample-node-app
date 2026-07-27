// Dynasty Central design tokens — a dark "command console" identity.
// Navy console ground, Signal Blue for interaction, Championship Gold reserved
// as the signature for meaning (dynasty value, on the clock, best asset).
//
// This is the visual source of truth in code — it implements docs/DESIGN_SYSTEM.md.
// Screens should consume these tokens (colors/space/radius/size/weight/motion/shadow/glow),
// not raw literals. Kept dependency-free (no react-native import) so it's safe to require
// anywhere, including pure logic + tests.
export const colors = {
  bg: '#080B15', // Midnight Ink — app ground (deepened for crest/gold contrast)
  card: '#141C30', // Console surface
  cardAlt: '#1B2540', // Console, raised/active
  border: '#28324D', // Hairline
  scrim: 'rgba(5,8,15,0.72)', // modal / sheet backdrop (one value, not three ad-hoc ones)
  text: '#EAF0FB',
  textDim: '#93A2BE',
  onAccent: '#08101E', // ink ON an accent/gold fill — dark, so button labels pass WCAG AA (white fails at 3.22:1)
  accent: '#4F8CFF', // Signal Blue — primary / interactive
  gold: '#F3C14A', // Championship Gold — the signature: VALUE / crest / on the clock (only)
  goldLite: '#FCE38F', // gold highlight (engraving top-light, championship node)
  goldDeep: '#7A5A18', // gold shadow / engraving hairline
  good: '#2FD196', // positive / win / gain — also the "target" tag hue
  bad: '#FF6470', // negative / loss / destructive — also the "avoid" tag hue
  warn: '#FFA23A', // caution / deadline — orange, kept distinct from gold
  watch: '#FFE94A', // Neon Yellow — the watchlist/target tag. Balanced R/G so it reads pure yellow (no green cast), still distinct from value gold + orange warn.
  // DECORATIVE ambient accent — NON-SEMANTIC. Electric Violet enriches the palette (backdrop glow +
  // decorative structure: eyebrows, dividers, rails, ambient watermark, decorative tags). It is
  // unclaimed by the color law, so it must NEVER mark an action, state, or value (those stay
  // blue/green-red-orange/gold). Purely atmosphere + ornament.
  violet: '#8B5CF6',
  violetDim: '#6E54B8', // a muted violet for hairlines/rails where full-chroma would shout
};

export const positionColors = {
  QB: '#FF6E8E',
  RB: '#3ED9A2',
  WR: '#5C9BFF',
  TE: '#F5C451',
  PK: '#B98CFF',
  DEF: '#8AA0C0',
};

// rgb triplets for the accents that drive the neon glow recipe (glow() takes a triplet string).
export const rgb = {
  accent: '79,140,255',
  gold: '243,193,74',
  good: '47,209,150',
  bad: '255,100,112',
  warn: '255,162,58',
  watch: '255,233,74',
  violet: '139,92,246',
};

// 4-based spacing scale — no raw padding/margin/gap literals in screens.
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

// Corner radii. md (14) is the default card/row/sheet radius.
export const radius = { sm: 10, md: 14, lg: 16, pill: 999 };

// Type scale. micro (11) is the floor — never smaller.
export const size = { micro: 11, caption: 12, bodySm: 14, body: 15, bodyLg: 16, title: 18, display: 20, hero: 26, mega: 34 };

// Font weights (RN string weights).
export const weight = { regular: '400', medium: '600', bold: '700', heavy: '800' };

// Motion durations (ms). See docs/MOTION_AND_NEON_ROADMAP.md for the register physics.
export const motion = { fast: 160, base: 260, slow: 480 };

// Elevation. Card lifts subtly; overlay (sheets/modals) lifts hard. Colored glow is glow() below.
export const shadow = {
  card: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  overlay: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
};

// The neon glow recipe (docs/DESIGN_SYSTEM.md §3): a lit edge + interior wash + soft halo, given an
// accent as an "r,g,b" triplet (see `rgb` above). The halo is a colored shadow — it renders on iOS;
// Android ignores shadow* (no elevation is set on purpose, so it never draws a grey box shadow), and
// the edge + wash carry the neon there. Returns a style object: `style={[styles.row, glow(rgb.watch)]}`.
export function glow(triplet, { edge = 0.55, wash = 0.12, halo = 0.35, radius: r = 16 } = {}) {
  return {
    borderWidth: 1,
    borderColor: `rgba(${triplet},${edge})`,
    backgroundColor: `rgba(${triplet},${wash})`,
    shadowColor: `rgb(${triplet})`,
    shadowOpacity: halo,
    shadowRadius: r,
    shadowOffset: { width: 0, height: 0 },
  };
}
