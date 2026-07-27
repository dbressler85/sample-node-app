# Dynasty Central — Design System

The single source of truth for the app's visual language. It exists because a six-cluster
UI audit (July 2026) found the pieces of a strong system already built — a good palette, an
Oswald display face, native-driven motion, a vector crest — but **applied inconsistently**:
titles in system bold on most screens, gold leaking off "value," four different loading/error
patterns, and every spacing/radius/size hardcoded per file.

This doc defines the system once. `mobile/src/theme.js` implements it as tokens; screens
consume the tokens, never raw values. When a screen and this doc disagree, **this doc wins** —
open a PR against the screen, not against the doc (unless the system itself is changing, in
which case change the doc first).

> **Status:** ratified 2026-07. The color law and the glow recipe are settled. Watch-yellow is now
> settled too — **Acid Yellow `#E4F24A`** ships (the earlier Neon Lime `#D6F84E` was dropped after
> seeing both in-row on device). Remaining follow-ups are tracked at the bottom (§13).

---

## 1. The one law: gold means value, neon means action

Two accent tiers, and they must never blur:

- **Championship Gold `#F3C14A` = VALUE, and only value.** Dynasty value numbers, "best asset,"
  on-the-clock, the crest. If a thing on screen is gold, it is telling you *worth*. Nothing else
  gets to be gold.
- **The neon tier = state & action.** Target / avoid / watch and the good / bad / warn states.
  These are the living, glowing signals — they carry *what's happening* and *what you can do*,
  not worth.

Everything else in the palette is chrome: the navy ground, Signal Blue for interaction, text,
borders.

**What this fixes (leaks to remove):**

| Today | Problem | Fix |
|---|---|---|
| Watchlist star is **gold** | "Watch" isn't value → dilutes gold | Watch → **Acid Yellow** (§2.4) |
| Trade SENT direction is **gold** (`TradesScreen.js`) | Direction isn't value | SENT → `textDim` / `warn` |
| Avatar rings, watch counts are **gold** | Account chrome isn't value | → `accent` or neutral |
| Value-lens toggle is **gold** (`PlayersScreen.js`) | A control isn't value | → `accent` like every other toggle |
| Lineup "optimal" total is **grey**; Draft on-clock is **green** | Value/on-clock *should* be gold | → **gold** |

---

## 2. Color

All colors live on the dark ground; every value below is chosen for it. Hexes are the source of
truth — `theme.js` names them.

### 2.1 Ground & structure
| Token | Hex | Use |
|---|---|---|
| `bg` | `#080B15` | App ground (Midnight Ink) |
| `card` | `#141C30` | Console surface — cards, rows, sheets |
| `cardAlt` | `#1B2540` | Raised / active surface, inset tracks |
| `border` | `#28324D` | Hairlines, dividers, inactive chip edges |
| `scrim` | `rgba(5,8,15,0.72)` | Modal/sheet backdrop (replaces the 3 ad-hoc scrims) |

### 2.2 Text
| Token | Hex | Use | Contrast on `card` |
|---|---|---|---|
| `text` | `#EAF0FB` | Primary text | ~15:1 |
| `textDim` | `#93A2BE` | Secondary / meta / labels | **6.58:1 — passes AA** |
| `onAccent` | `#08101E` | Ink **on** an accent/gold fill (see §2.6) | ~6:1 on accent |

> The audit's worry about `textDim` was unfounded — 6.58:1 on card clears AA small text.
> Do **not** shrink secondary text below **11px** or stack opacity on it; that's where legibility
> actually breaks (some captions were 9–10px + `opacity:0.75`).

### 2.3 Brand
| Token | Hex | Use |
|---|---|---|
| `accent` | `#4F8CFF` | Signal Blue — interactive, primary, active chip/segment, links |
| `gold` | `#F3C14A` | **VALUE** (see §1). AAA contrast (10:1 on card) |
| `goldLite` | `#FCE38F` | Gold highlight (engraving top-light, champion node) |
| `goldDeep` | `#7A5A18` | Gold shadow / engraving hairline |

### 2.4 Neon accent tier (state & action)
The glowing signal layer. Target and Avoid **reuse** the status hues (§2.5) so we don't ship
duplicate colors; Watch is the one genuinely new token. The *neon feel* comes from the **glow
recipe (§3)**, not from a second set of hexes.

| Token | Hex | Meaning | Notes |
|---|---|---|---|
| `target` → `good` | `#2FD196` | Target this player | Same hex as `good` |
| `avoid` → `bad` | `#FF6470` | Avoid this player | Same hex as `bad` |
| **`watch`** | **`#E4F24A`** | On your watchlist | **Acid Yellow.** (Neon Lime `#D6F84E` was the earlier pick, dropped — §13) |

**Why a yellow for watch:** it must separate cleanly from the two warm tones it will sit beside —
gold `#F3C14A` (~44°), warn `#FFA23A` (~30°) — while staying unmistakably "yellow." Acid `#E4F24A`
(~64°) gives a wide warm separation while reading as a true yellow rather than chartreuse. It is well
clear of target-green (~157°), so there is zero collision risk with Target even though both are
"bright." (Neon Lime `#D6F84E`, ~74°, was the first candidate but read too chartreuse in-row on device.)

**Avoid rows must not dim to opacity.** Today `faRowAvoid` drops the whole row to `opacity:0.55`,
killing legibility and the tap target. Signal avoid with the **red glow recipe** (edge + wash),
mirroring how Target uses the green one.

### 2.5 Status (base semantic)
| Token | Hex | Use | Contrast on `card` |
|---|---|---|---|
| `good` | `#2FD196` | Positive / win / gain | 8.63:1 |
| `bad` | `#FF6470` | Negative / loss / destructive | 5.90:1 |
| `warn` | `#FFA23A` | Caution / deadline / nearing | 8.46:1 |

Rules: `bad` is **destructive/negative only** — a "caution" construction rating must be `warn`,
not `bad` (they're currently collapsed). A **BYE is not an injury** — it must not share OUT/IR's
`bad` red; give it `warn` or neutral so red keeps meaning "he's out."

### 2.5b Decorative accent — Electric Violet (`#8B5CF6`, non-semantic)

Violet is the app's **atmosphere/ornament** accent. It is **unclaimed by the color law** and must
**never** mark an action, state, or value — those stay accent-blue / green‑red‑orange / gold. It only
appears as decoration: the ambient backdrop glow (two blooms + a wash in `FieldBackdrop`), the screen‑
title rule (`Brand.ScreenTitle`), and the neutral **hairline** (`border` is a violet‑biased grey, so
every card/divider edge carries a faint tint — a *chosen* neutral, not a semantic mark). `violetDim`
`#6E54B8` is for rails where full chroma would shout. Dose is deliberately felt, not shouted; if it ever
competes with a semantic color for meaning, pull it back. Tokens: `violet`, `violetDim`, `rgb.violet`.

### 2.6 The `onAccent` fix (the one real contrast bug)
White on the bright `accent` fill computes to **3.22:1 — fails WCAG AA.** Primary buttons
(`ErrorView` Retry, `InfoDot` "Got it") use it today.

**Rule:** a label sitting **on** an `accent` or `gold` fill uses `onAccent` (`#08101E`), never
white. Dark-on-accent computes to ~6:1 — passes. There is one Button primitive (§10) so this is
fixed in exactly one place.

### 2.7 Positional colors (unchanged, correct)
`QB #FF6E8E · RB #3ED9A2 · WR #5C9BFF · TE #F5C451 · PK #B98CFF · DEF #8AA0C0`

Use as the row's **left position stripe** (`borderLeftWidth:3`) and the position dot/pill
everywhere a player appears — including the shared `PlayerRow` (Roster/Compare currently drop it).

---

## 3. The glow recipe

Every neon accent (target/avoid/watch, and good/bad/warn when used as a signal surface) renders
with the same three-part recipe so "neon" is consistent, not ad hoc. Given an accent color `C`
(rgb triplet):

| Layer | Value | Notes |
|---|---|---|
| **Edge** | `1px solid rgba(C, 0.55)` | The lit outline |
| **Wash** | `backgroundColor: rgba(C, 0.12)` | Faint interior fill over `card` |
| **Halo** | `shadowColor: C, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset:{0,0}` | Soft bloom |
| **Hot text** | text in `C`; on iOS add `textShadow` `0 0 10 rgba(C,0.6)` | For the star/label glyph |

**Cross-platform reality:** the **halo needs a colored shadow — iOS only.** Android elevation
won't tint. So the neon that ships on *both* platforms is **edge + wash + the saturated color
itself**; the halo is an iOS enhancement layered on top. Never rely on the halo alone to carry a
state — edge + wash must read the signal without it.

`theme.js` exposes `glow(C)` returning the edge+wash (+iOS halo) style object, so a screen writes
`style={[styles.row, glow(colors.watch)]}` instead of hand-mixing alphas.

---

## 4. Typography

### 4.1 The display face
**Oswald** (condensed broadcast face) is loaded defensively and exposed via helpers in
`typography.js`. It is the app's identity — and today it's used on ~4 screens. **Every screen
title and section label must go through a helper.** Numbers stay on the system face for tabular
alignment (§4.3).

| Helper | Face | Use |
|---|---|---|
| `displayXL()` | Oswald 700 | Top-level tab screen titles (`ScreenTitle`, ~26px) |
| `displayLg()` | Oswald 600 | Overlay topbar titles (~18–20px) — **new helper** |
| `displayLabel()` | Oswald 600 | Section labels (uppercase, tracked) |
| `displayNumber()` | Oswald 600 + tabular | Hero stat numbers (portfolio total, big value) — **new helper** |

Wire the loaded-but-unused `Oswald_500Medium` into `displayNumber()` or `displayLg()`.

### 4.2 Type scale
Replace the ~9 hardcoded sizes with one ramp (`size.*`):

| Token | px | Use |
|---|---|---|
| `micro` | 11 | Labels, chip text — **floor, never below** |
| `caption` | 12 | Meta, secondary lines |
| `bodySm` | 14 | Dense body, list secondary |
| `body` | 15 | Default body |
| `bodyLg` | 16 | Emphasized body |
| `title` | 18 | Overlay topbar title (`displayLg`) |
| `display` | 20 | Large section / card title |
| `hero` | 26 | Screen title (`displayXL`) |
| `mega` | 34 | Hero stat (`displayNumber`) |

**Weights** (`weight.*`): `regular 400 · medium 600 · bold 700 · heavy 800`. Stop mixing 800/900
ad hoc; headings are `bold`/`heavy`, body is `regular`/`medium`.

### 4.3 Numbers — always tabular
Every number that **animates, updates, or stacks in a column** gets
`fontVariant: ['tabular-nums']`: live scores, portfolio totals (`AnimatedNumber` itself lacks it
today and visibly reflows width as it ticks), value columns, ranks, draft overall/round·pick.
Standings already does this — make it universal. `AnimatedNumber` and `displayNumber()` set it by
default.

### 4.4 Section label — one treatment everywhere
Today there are 4+ (Home mixed-case 15/800; Profile uppercase 12; Settings uppercase accent 13;
standings 11). **One** `SectionLabel`: `displayLabel()`, uppercase, `letterSpacing ~0.16em`,
`size.caption` (12), `textDim`. Nothing else.

---

## 5. Spacing

4-based scale (`space.*`). No raw padding/margin/gap literals in screens.

| Token | px |
|---|---|
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 20 |
| `xxl` | 24 |
| `xxxl` | 32 |

Default screen padding `lg` (16); card padding `lg`; gap between sibling rows `sm`–`md`.

## 6. Radius

| Token | px | Use |
|---|---|---|
| `sm` | 10 | Chips, small controls, buttons |
| `md` | 14 | Cards, rows, sheets — **the default** |
| `lg` | 16 | Large sheets, hero cards |
| `pill` | 999 | Fully-rounded pills, dots |

(Resolves the current 12/14/16 card-radius drift → standardize on `md`.)

## 7. Elevation, shadow & overlay

| Token | Value | Use |
|---|---|---|
| `shadow.card` | `shadowColor '#000', opacity 0.35, radius 8, offset {0,3}` (Android `elevation:3`) | Cards that lift off ground |
| `shadow.overlay` | `opacity 0.5, radius 20, offset {0,8}` (`elevation:12`) | Sheets, modals |
| `glow(C)` | see §3 | Neon signal surfaces (dynamic per accent) |

Scrim behind any modal/sheet: `colors.scrim` (§2.1). One value — not `#000A` / `rgba(10,15,28,.92)`
/ `rgba(10,15,28,.96)`.

## 8. Motion

One motion module (`motion.*`) so entrance/exit feel is uniform:

| Token | Value | Use |
|---|---|---|
| `dur.fast` | 160ms | Taps, chip state, toasts in |
| `dur.base` | 260ms | Standard transitions, toast out |
| `dur.slow` | 480ms | Entrance reveals (`Reveal`) |
| `ease.out` | `Easing.out(Easing.cubic)` | Default decelerate |
| `spring.press` | standard `PressableScale` config | Press feedback |

**Reduce-motion is mandatory.** Read `AccessibilityInfo.isReduceMotionEnabled()` once at app root
into a shared flag (`useReducedMotion`), and:
- `Pulse` — stop the infinite loop; render at rest.
- `Celebrate` — skip confetti (still fire the toast/announcement).
- `Reveal` — snap to settled state (it already guarantees the *end* state; also skip the tween).

Entrance animations must always **default to their settled state** so a render that doesn't
animate can never strand or blank content (hard-won rule from `CLAUDE.md`).

## 9. Touch targets & accessibility

- **Minimum target 44×44pt.** Sweep the offenders the audit found: inline Target/Avoid/Watch
  icons (~30px), draft-list reorder glyphs (~26px), lineup mode tabs (~30px), sort chips (~28px),
  back buttons (~40px), trade deadline controls. Fix via `minHeight:44` on controls and a
  `hitSlop` helper that pads a small glyph up to 44.
- **Icon-only controls need `accessibilityLabel`**; segments need `role:"tab"` + selected state;
  checkboxes need `role:"checkbox"` + `accessibilityState.checked`. Only a couple of files do this
  today.
- **Announce confirmations to screen readers.** Toast/Celebrate replace Alerts but are silent to
  VoiceOver/TalkBack — call `AccessibilityInfo.announceForAccessibility(message)` on emit and set
  `accessibilityLiveRegion="polite"`.
- Contrast: every foreground/background pairing must clear **AA (4.5:1 small, 3:1 large)**. The
  palette passes; the only rule to enforce is `onAccent` on accent/gold fills (§2.6).

## 10. Component standards

Shared primitives — build once, delete the per-screen copies.

- **`Button`** — `variant: primary | ghost | destructive`. Primary = `accent` fill + `onAccent`
  label; radius `sm`; `minHeight:44`; `accessibilityRole:"button"`. Replaces the hand-rolled
  buttons in `ErrorView`/`InfoDot`/`HelpScreen` (which is why the contrast bug exists twice).
- **`SectionLabel`** — §4.4.
- **`Card`** — `card` bg, radius `md`, padding `lg`, `shadow.card`.
- **Segmented control** — one inset-track style (`cardAlt` track, `accent`-tinted active segment)
  for *all* toggles: Draft Pick|Board, DraftList, Portfolio holdings, lineup mode. The Pick|Board
  switcher currently uses the least-refined bordered-pill style — adopt the track.
- **State views (the big consistency win):**
  - `LoadingSkeleton` — shaped to the list it replaces (Roster shows a roster skeleton, not a bare
    spinner). Never a lone `ActivityIndicator` for a list load.
  - `ErrorView(onRetry)` — **always** has retry; **never** a dead end (Roster/OnTheBlock/OnDeck
    errors currently strand). And a network failure must **never** be rendered as an empty result
    (`TradeAcrossSheet`/`AddAcrossSheet` currently `.catch(() => setPreview({leagues:[]}))` — the
    user wrongly concludes the action is impossible). Track `error` distinct from `empty`.
  - `EmptyView` — icon + title + one line + optional CTA. Make the rich treatment
    (Playoff/Trophy/OnDeck already have it) universal; kill the bare one-liners.
- **Sheets** — bottom-anchored, `scrim` backdrop, a **36×4 grabber** under the top radius, and
  `KeyboardAvoidingView` whenever the sheet holds a text input (claim bid, reject note, asking
  price all currently let the keyboard cover the confirm button). One overlay idiom — the reject
  modal's center-anchored style should become a bottom sheet like the rest.
- **Irreversible actions confirm.** Any hard-to-undo MFL write gates behind a confirm echoing the
  action. **Accept-trade currently fires on a single tap** while Reject/Withdraw both confirm —
  close that gap.

## 11. Iconography

One icon language. The `NavIcons` stroked family is good; **emoji used as UI icons are not part of
the system** — they don't take the active/dim tint and render differently per Android OEM. Migrate
the in-list ones (⏳ deadline, ⭐ watch, 📥 trade inbox, 🔁 trades, ⚡ device, 🏆 bracket) to
stroked glyphs from the same family or to tinted status dots. (Tracked as its own task — see §13.)

## 12. `theme.js` token shape (implementation target)

The doc above becomes this export. Screens import tokens; no raw literals.

```js
export const colors = {
  bg:'#080B15', card:'#141C30', cardAlt:'#1B2540', border:'#28324D',
  scrim:'rgba(5,8,15,0.72)',
  text:'#EAF0FB', textDim:'#93A2BE', onAccent:'#08101E',
  accent:'#4F8CFF', gold:'#F3C14A', goldLite:'#FCE38F', goldDeep:'#7A5A18',
  good:'#2FD196', bad:'#FF6470', warn:'#FFA23A',
  watch:'#E4F24A',            // Acid Yellow (Neon Lime '#D6F84E' dropped — §13)
  // aliases: target === good, avoid === bad (same hex, tag-tier meaning)
};
export const positionColors = { QB:'#FF6E8E', RB:'#3ED9A2', WR:'#5C9BFF', TE:'#F5C451', PK:'#B98CFF', DEF:'#8AA0C0' };

export const space  = { xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32 };
export const radius = { sm:10, md:14, lg:16, pill:999 };
export const size   = { micro:11, caption:12, bodySm:14, body:15, bodyLg:16, title:18, display:20, hero:26, mega:34 };
export const weight = { regular:'400', medium:'600', bold:'700', heavy:'800' };
export const motion = { fast:160, base:260, slow:480 };
export const shadow = {
  card:    { shadowColor:'#000', shadowOpacity:0.35, shadowRadius:8,  shadowOffset:{width:0,height:3},  elevation:3 },
  overlay: { shadowColor:'#000', shadowOpacity:0.5,  shadowRadius:20, shadowOffset:{width:0,height:8},  elevation:12 },
};

// rgb triplet string per accent, e.g. glow('214,248,78') for watch
export function glow(rgb, { halo = true } = {}) {
  return {
    borderWidth: 1,
    borderColor: `rgba(${rgb},0.55)`,
    backgroundColor: `rgba(${rgb},0.12)`,
    ...(halo && Platform.OS === 'ios'
      ? { shadowColor: `rgb(${rgb})`, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width:0, height:0 } }
      : null),
  };
}
```

Migration is mechanical and can land in slices (colors + `glow` + `onAccent` first; then the
typography helpers; then spacing/radius sweeps) — no need for one giant PR.

## 13. Open decisions & follow-ups

- **Watch-yellow hue** — **settled: Acid Yellow `#E4F24A`.** Neon Lime `#D6F84E` was the first
  candidate but read too chartreuse against gold in-row on device; dropped. (`theme.js`/`neon.js`
  `watch` token is `#E4F24A`.)
- **Icon migration (emoji → vector)** — §11; sized as its own batch, not blocking the token work.
- **`hot` tag variants** — if the neon accents want extra punch beyond the glow recipe, add
  brighter `*Hot` stroke variants for the tag tier only (base status hues stay put). Defer until
  we see the glow recipe on device.

---

## How this maps to the build plan

- **Batch 1 (safety + regression):** Accept-trade confirm; Draft Board on-clock → gold (§1) + fix
  the mine/on-clock color collision.
- **Batch 2 (foundation):** extend `theme.js` per §12; add `onAccent` + the Button primitive
  (§2.6/§10); route titles/labels through the Oswald helpers (§4); make numbers tabular (§4.3).
- **Batch 3 (states + targets):** the shared Loading/Error/Empty views (§10) — including the
  "network-error-disguised-as-empty" fix; sweep sub-44px targets and reduce-motion (§8/§9).
- **Then:** watch → Acid Yellow with the glow recipe; avoid-row off opacity onto the red glow;
  icon migration.
