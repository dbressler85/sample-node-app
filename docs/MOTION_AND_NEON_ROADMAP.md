# Motion & Neon Roadmap

How Dynasty Central goes from "one impressive screen (login) and quiet everywhere else" to an app
that feels **alive, kinetic, and unmistakably ours.** This is the motion + identity companion to
[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) — the design system defines the static tokens (color law,
glow recipe, scales); this doc defines how they *move*, and the neon-sign identity that carries the
signature. It also sequences the motion work together with the UI-audit findings so there's one
throughline, not competing to-do lists.

> **Status:** ratified 2026-07. Direction and phase order are settled; exact durations/easings are
> tuned on device (§7). This supersedes the design system's §8 stub and §11 icon note.

---

## 1. Two worlds, four registers

The core principle: **crossing into/out of the app must feel different from moving around inside
it.** A threshold is ceremony you watch; traversal is momentum you feel. Blur them and everything
becomes one generic "more animation." Four registers, each with its **own physics on purpose**:

| Register | Where | Physics | Today |
|---|---|---|---|
| **Threshold** | Login, logout | Slow (~600–900ms), decelerating, symmetric; elements assemble/disassemble from the crest outward. Reverent — you watch it | Login ✅ · logout missing |
| **Traversal** | Screen↔screen, tab↔tab, open/close overlays | Medium (~280–340ms), **directional** spring momentum; you feel place & direction | **Empty — the biggest gap** |
| **Texture** | Taps, toggles, the row you just acted on, numbers | Fast (120–220ms), snappy; barely noticed alone, cumulatively "alive" | Partial (press-scale, number roll) |
| **Punctuation** | Trades, wins, claims, drafts | Neon signs that flicker to life (§3); reserved for real moments | Confetti exists, underused |

Threshold and Traversal are the ones that must not blur: **in mirrors out** (Threshold is
symmetric), **forward feels forward** (Traversal is directional).

---

## 2. Register specs

### 2.1 Threshold — the neon crest ignition (hero moment)
The first and last thing a user ever sees. The crest is rendered as a **full neon sign — the entire
logo is lit tube: shield outline, outer rim, the crown, and the DC monogram, every element glowing
gold.** Nothing in the crest is flat; it's all neon.

- **Login → app:** user taps *Log in* → the **whole crest ignites** (flicker → false-start →
  catch → bloom with a slight overshoot → settle to a steady gold hum) → holds one confident beat →
  the login lockup (wordmark, rule, form) **flies out** (rises + fades up and away) as the app
  assembles behind it. The ignition reads as "the console powering on."
- **App → logout:** the exact mirror — the app powers down, the login lockup flies back in, and the
  crest **flickers out**. In mirrors out.
- **Timing:** ignition ~600–800ms; fly-out ~360ms decelerating; total threshold under ~1.2s.
- **Implementation note:** ignition needs the crest as **strokable vector tubes**, so it's built on
  the vector `HubMark`, extended into a neon variant driven by the glow recipe + a flicker value.
  The raster watermark in `FieldBackdrop` (`adaptive-icon.png`) can't light per-tube and is not used
  for the ignition — it stays the faint ambient watermark it is now.

### 2.2 Traversal — moving within (pulled early: Phase 2)
The layer you feel on **every single tap**, and today it's blank (overlays just appear, tabs swap
instantly). This is the single biggest "expensive native app" lever, which is why it's pulled up
directly after the foundation.

- **Overlays (player profile, trade desk, draft, roster):** lift toward you from the tapped row —
  a scale-up + fade from the touch origin; **back drops it home** the same way. Gives every drill-in
  a sense of *place*.
- **Tab ↔ tab:** a quick directional slide/crossfade (~200ms) in the direction of travel, not an
  instant cut.
- **Screen push/pop:** incoming screen slides + slightly scales in from the travel direction;
  outgoing parallaxes back and dims; back reverses exactly.
- **Spring momentum**, not linear — motion has weight and settles.
- **Must never fight instant-paint (UX guardrail):** content is already painted from the
  survive-remount cache; the transition *wraps* that paint, it never gates it. A skipped transition
  still shows the fully-painted screen.

### 2.3 Texture — life in place
The micro-feedback that adds up to "alive." Fast, snappy, easy to overdo — apply with restraint.

- **Press:** depress + spring back (extend `PressableScale`) on all primary controls.
- **The row you just acted on** flashes its accent (a claim glows the neon lime/green, then settles)
  so an action visibly *lands* on the list, not just silently mutates.
- **Numbers roll** (`AnimatedNumber`, now tabular) for the handful of hero stats.
- **Chips/segments pop** slightly when toggled; **skeletons shimmer** while loading.

### 2.4 Punctuation — neon signs
The signature. Fully specified in §3.

---

## 3. The neon-sign system

**Emoji are banned from the app — they read cheap and render differently per device.** Every glyph
becomes a **wired neon sign**: near-white tube core + colored bloom (the glow recipe from
`DESIGN_SYSTEM.md §3`), and the signature detail — it **flickers on like a real sign**.

### 3.1 The ignition (flicker-on)
Off → a couple of false starts (quick flicks that drop back out) → it **catches** → **blooms** with a
brief glow overshoot → **settles** to full, with an optional barely-there hum. ~500–900ms depending
on the moment. This is the "turning on" that makes it feel wired, not drawn.

### 3.2 Two grades — so the app never strobes
- **Moment signs** (animated ignition): fired on real events — a trade, a win, a claim, the logo.
  Reserved, so the flicker stays special.
- **Inline icons** (steady glow, **no flicker**): watchlist, deadlines, inbox, etc. sit lit with a
  calm steady bloom. They're neon, but they don't ignite every render (that would be exhausting).

### 3.3 Tone lives in the wiring
- **Happy / win:** clean bloom, steady hum.
- **Sad / reject / outbid:** the **broken-sign flicker** — a tube that never fully settles, one
  segment stuttering. This lands the app's existing deadpan humor better than any cartoon glyph.

### 3.4 Symbols or words
A neon sign is literally glowing text, so **words are as on-brand as symbols** — mix per moment:
- **Iconic → drawn glyph:** the red **X** (reject), a **check** (accept), a **trophy** (win).
- **Abstract → neon word:** **SENT**, **WIN**, **L**.

### 3.5 Celebration = neon sparks
The multicolor paper confetti is retired. Wins throw a short **neon spark burst** in the accent
palette — same energy, on-brand, not "party emoji."

### 3.6 Cross-platform & accessibility
- **Bloom:** layered strokes + the iOS halo (glow recipe). The halo is iOS-only (Android can't tint
  a shadow); edge + wash + saturated core carry it on both. **Flicker is pure opacity — identical
  everywhere.**
- **Reduce-motion:** no flicker, no sparks — the sign appears **steady and fully lit** (settled
  state), consistent with the entrance-defaults-to-settled guardrail.

### 3.7 Emoji → neon inventory
Every current emoji, mapped. (Moment = animated ignition; Inline = steady glow.)

| Current | Event / use | Neon replacement | Grade · color · tone |
|---|---|---|---|
| 🙅 | Reject a trade | Big **X** glyph | Moment · `bad` · broken flicker |
| 🤝 | Trade accepted | **Check** glyph (or "DEAL") | Moment · `good` · clean |
| 📨 | Offer sent | **"SENT"** (or paper-plane) | Moment · `accent` · clean |
| 📝 | Claim placed | **"BID IN"** | Moment · `accent` · clean |
| 🏆 | Matchup won | **Trophy** glyph + sparks | Moment · `gold` · hero |
| ↩️ | Offer withdrawn | **Undo-arrow** glyph | Moment · `cold`/dim · quick |
| 📉 | Claim failed / outbid | **"OUTBID"** (or down-arrow) | Moment · `bad` · broken flicker |
| 💀 | Matchup lost | **"L"** (skull optional) | Moment · `cold` · broken flicker |
| ⭐ | Watchlist | **Star** glyph | Inline · `watch` (Neon Lime) · steady |
| ⏳ | Trade deadline | **Hourglass** glyph | Inline · `warn` · steady |
| 📥 | Trade inbox | **Tray** glyph | Inline · `accent` · steady |
| 🔁 | Trades | **Swap-arrows** glyph | Inline · `accent` · steady |
| ⚡ | Device / live read | **Bolt** or lit dot | Inline · `accent` · steady |
| 🎉 | "All clear" empty state | Calm **check** / "ALL CLEAR" | Inline · `good` · steady |

Chevrons (`›`) and other pure-text marks are already vector — keep them, tinted via tokens.

---

## 4. Phase roadmap

Sequenced by dependency. **Traversal is pulled to Phase 2** per the decision to make the everyday
in-app feel jump early. Each phase is a coherent **EAS-build checkpoint** — trigger a build when a
phase lands, never per-change (builds are a scarce monthly credit).

| Phase | Scope | Why here | Depends on |
|---|---|---|---|
| **0 · Safety + regressions** | Accept-trade confirm; Draft-Board on-clock → gold + fix the mine/clock color collision | Tiny, independent; one's a regression already on `master`. Ship immediately | — |
| **1 · Foundation** | `theme.js` scales (space/radius/size/motion) · `glow()` · `onAccent` · Oswald helpers (`displayLg`/`displayNumber`) · tabular-nums · `useReducedMotion` · shared **Button / SectionLabel / Loading / Error / Empty** primitives | Every visual + motion change leans on these. Nothing else is clean first | — |
| **2 · Traversal** *(pulled early)* | Directional overlay open/close (lift-from-row), tab slide/crossfade, screen push/pop with spring momentum | The feel you hit on every tap; the biggest day-to-day "impressive" lever. Only needs motion tokens | Phase 1 |
| **3 · Consistency sweep** | Oswald on every title/label · **gold discipline** (pull leaks, watch → Neon Lime) · standardize chips/cards/radius · sweep sub-44px targets · unify loading/error/empty (kills the "network-error-shown-as-empty" bug) · reduce-motion on Pulse/Reveal/Celebrate · **+ per-screen P2/P3 polish** (Sparkline on profile, SlotEditor position pills, trade net-chip, avoid-row off opacity, …) | Turns "several nice screens" into one system and gives neon a clean stage | Phase 1 |
| **4 · Neon signature** | `NeonSign` + flicker engine (reduce-motion aware) → **prototype reject-X on device** first · map every emoji → neon per §3.7 (moment signs animate, inline icons steady) · celebration → neon sparks | The Punctuation register **and** the emoji-kill, as one build | Phase 1 (`glow()`, reduce-motion) |
| **5 · Threshold + Texture** | **Neon crest ignition** (whole logo) + login fly-out + logout mirror · **Texture** sweep (press feedback, acted-on row flash, value roll-ups, chip pops) | The bookend ceremony + the in-place life, on top of a clean, neon-capable base. The crest ignition *is* a `NeonSign`, so it follows Phase 4 | Phases 1, 4 |

**Why this order:** you can't spread neon or motion cleanly before the tokens and `glow()` exist
(Phase 1); Phase 0 jumps the line because it's safety. Traversal (2) rides only the motion tokens,
so it can come before the consistency sweep — the tradeoff the owner chose to feel in-app movement
sooner. The neon crest ignition (5) depends on the `NeonSign` pipeline (4), so the Threshold hero
lands last, as the finishing flourish.

---

## 5. Ratified decisions

- **The entire crest is neon** — shield, rim, **crown**, and DC monogram all lit; nothing flat.
- **Traversal pulled to Phase 2** (before the consistency sweep).
- **No emoji anywhere** — every glyph is a neon sign (§3.7).
- **Two grades:** moment signs flicker on; inline icons glow steady.
- **Symbols + words mix** — glyph when iconic, neon word when abstract.
- **Sad = broken flicker;** happy = clean bloom + steady hum.
- **Confetti fully replaced by neon sparks.**
- **Watch = Neon Lime `#D6F84E`** (per `DESIGN_SYSTEM.md`; Acid `#E4F24A` held as on-device alt).
- **Reduce-motion:** everything resolves to its steady, fully-lit settled state.

## 6. Guardrails this must honor

- **Instant-paint:** traversal transitions wrap an already-painted screen; they never gate the paint.
- **Entrance defaults to settled state:** a render that doesn't animate can never strand or blank
  content (uncatchable-blank-root rule).
- **Reduce-motion** is respected in every register.
- **EAS builds are scarce** — batch to the phase checkpoints; the owner triggers builds.

## 7. Open / tune-on-device

- Exact ignition timing + how many false-start flicks (tune the crest live).
- Traversal depth: simple directional slide vs. a shared-element "lift from the tapped row" — decide
  when prototyping Phase 2 on a real device.
- Sad glyphs: neon "L" vs. a neon skull — decide when the `NeonSign` glyph set is drawn.
- Acid vs. Neon Lime for watch — settle once seen in-row on device.
