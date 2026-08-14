# Design-system polish backlog

Prioritized output of a design-system PO review (color law, tokens, iconography, component
consistency) across all 32 screens + 50 components, measured against
[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) and `mobile/src/theme.js`. Ordered by value ÷ risk.
The headline finding: **the primitives (`Button`, `BottomSheet`, `EmptyView`/`ErrorView`/
`ListSkeleton`, `displayLabel`, `NeonSign`) exist and are correct — the gap is adoption, not
missing infrastructure.**

All items are mobile-only (ride an EAS build). Visual sweeps should be eyeballed on a real
build before merge.

## Already shipped (not in this backlog)
- Color-law compliance: LeagueScreen plan chip violet→accent, TrophyCase gold action buttons→
  accent, Players load-more spinner gold→accent. (PR #374)
- TradesScreen overlay title → shared violet `TopbarTitle`.
- LineupEditor error dead-end → `ErrorView` with Retry (§10 "never a dead end").
- **Paywall gold** is a ratified brand exception — see DESIGN_SYSTEM.md §13. Not to be "fixed".

---

## P1 — Adoption sweeps (highest leverage; the review's through-line)

1. **Adopt the `Button` primitive across the ~18 hand-rolled CTAs.** `Button.js` is imported by
   zero screens; every primary/confirm button re-implements height, radius, busy-spinner, and
   ink color independently, so the 44pt floor + `onAccent` contrast are only where each author
   remembered them. **Biggest single win; deletes the most-duplicated code in the app.** Do in
   slices of ~4 screens, eyeballing each.
   - **Slice 1 — DONE:** LineupEditor (save), DraftList (save), TrophyCase (empty CTA + sheet
     Cancel `ghost` / Add-trophy `primary`).
   - **Slice 2 — DONE:** Login (Log in), Lineups (Set-All), WaiverWizard (submit), Waivers (Add +
     Update-bid), Trades (Propose + OfferCard accept `primary` / reject·withdraw·dismiss `ghost` +
     reject-modal + DropSheet), TradeInbox (accept `primary` / reject `ghost`). Policy applied:
     accent-filled → `primary`; neutral secondaries (reject/withdraw/dismiss) → `ghost` (they're
     intentionally NOT alarming, so not `destructive`); tertiary text-link cancels left as-is.
   - **Intentional exceptions (NOT converted):**
     - **Paywall** CTA — gold + glow + pill hero; `Button.gold` is a flat fill with no glow/pill, so
       converting would strip the ratified brand look. Left bespoke.
     - **PlayerProfile** drop — **DONE (PR #403):** added a `filledDestructive` variant to `Button`
       (solid `bad` fill, dark ink so it passes AA — white fails on the coral red) and converted the
       DropSheet confirm (→ `filledDestructive`) + cancel (→ `ghost`). The compact action-row Drop
       *trigger* stays a bordered pill to match its Add/Shop/Trade siblings.
     - **Settings** test/diagnose — accent-bordered *utility* buttons; `Button.ghost` (neutral) would
       drop the accent affordance. Left, or add a `utility`/outline-accent variant.
   - Dead per-screen button styles from converted sites are left inert; prune in a later pass.

2. **Swap the ~18 bare first-load spinners for `ListSkeleton`** (§10 — "never a lone spinner for a
   list"). Start with RosterScreen:220 (named in the doc). Also PlayerProfile:183, Playoff:81,
   Trophy:164, PickInventory:57, DraftHub:84, Draft:351, TradeInbox:258, TradeFinder:59,
   PickTradeFinder:56, Leagues:166, DraftList:150, WaiverWizard:338, Portfolio:120, Lineups:112,
   Waivers:523/706, Home:386.
   - **Slice 1 — DONE:** the read-list overlays — TradeInbox, PickInventory, PickTradeFinder,
     TradeFinder, DraftHub, PlayoffBracket. Each was a body-level spinner beneath an already-rendered
     header, so the swap kept the header and just filled the body; unused `ActivityIndicator` imports
     pruned. (Closes usability backlog #26 for these.)
   - **Slice 2 — DONE:** Roster, PlayerProfile, Trophy (body-level swaps) + Portfolio (full-screen
     cold-load, wrapped in the screen container). Kept each file's other in-place spinners (Roster
     move-row busy, Trophy detect).
   - **Slice 3 — DONE (PR #404):** the list-first cold loads — Leagues (ListEmptyComponent), Scores,
     Lineups, DraftList (below its header). **Judged-out (kept the lone spinner):** Home (a tiles +
     portfolio dashboard, not a list) and Draft (a live draft board whose first paint is the on-clock
     header, not list rows) — a card-row skeleton would misrepresent both.
   - **Remaining:** Waivers boards (the FA board + best-available already skeleton via their own paths;
     any lone spinner left there is a streaming/secondary load) — judge per-site if a build shows one.

3. **Route the ~10 hand-rolled section labels through `displayLabel()`** so the eyebrow renders in
   Oswald everywhere (today it's Oswald on ~half the screens, system font on the rest).
   - **DONE (PR #400):** the structural `violetText` eyebrows + the two clear Trades section labels —
     OnDeck (section header), Scores (still-to-play), Roster (sort + position headers), Players
     (control labels), Waivers (claims title), OnTheBlock (asking price), TradeInbox (season label),
     WaiverWizard (submitted + pos-group headers), Trades (deadline + YOU SEND/GET). Applied at the
     JSX site (displayLabel() must be called at render, NOT in StyleSheet.create where fonts.ready is
     still false). Left data-table headers, uppercase player names, and inline chip micro-labels alone
     (not eyebrows).
   - **Remaining:** **pin the numeric contract** (size.caption 12 / ~0.16em) inside the helper or a
     shared style so the current size drift (10/11/12/13) can't recur — deferred (baking size into
     displayLabel() risks overriding callers that intentionally spread it after their own fontSize).

4. **Give the ~15 bare `<Text>No X</Text>` empties to `EmptyView`** (§10). Sites incl.
   Trades:642, Players:442/485/512/536/596, Waivers:401/710/1038, DraftList:226/276,
   WaiverWizard:452/667, Portfolio:588, DraftHub:88, TradeInbox:284, PickInventory:61/72,
   Draft:392/454, OnTheBlock:352/380. Fold the "rich inline" empties (Scores:105, Playoff:90,
   Trophy:178) into `EmptyView` too so there's one treatment, not three.
   - **Slice 1 — DONE:** the whole-body empties — DraftHub ("No drafts right now"), PickInventory
     ("No draft picks"), Draft ("No draft in this league") — now use `EmptyView` (title + message).
     Left TradeInbox's rich neon-glyph empty ("Quiet in here") as-is — it's a deliberate richer
     treatment `EmptyView` can't yet match (no glyph until the Phase-4 neon slot).
   - **Slice 2 — DONE (PR #402):** the in-list `ListEmptyComponent` / inline empties — Players (search,
     rookies, rank, free, watch, mine, news), Waivers (no-leagues, position FA, couldn't-load-with-retry
     via `EmptyView`'s action, pending), DraftList (empty list). Left the search-as-you-type hints
     (Waivers new-claim sheet, DraftList add-players) as lightweight inline text — a full `EmptyView`
     is oversized in a compact search area. Pruned the dead empty/note/faEmptyWrap/retry styles.
   - **Remaining:** the rich inline empties (Scores, Playoff, Trophy) still use bespoke richer
     treatments — fold in once the Phase-4 neon glyph slot lands (EmptyView can't match them yet).

## P2 — Iconography (tracked batch — DESIGN_SYSTEM.md §11)

5. **Emoji → vector icon migration (~46 sites).** Vectors already exist for nearly all of them
   (`x`, `check`, `swap`, `bolt`, `star`/`WatchIcon`, `target`/`TargetIcon`, `AvoidIcon`, `bang`,
   `trophy`, `search`, `dollar`, `tag`, and now `info`). Do highest-visibility first:
   - **Slice 1 — DONE (PR #399):** the shared primitives that propagate everywhere — `Checkbox` (`✓`
     → `check` vector via a new plain `GlyphMark` renderer), `Toast` (`✓`/`ℹ`/`⚠` → `check`/`info`/
     `bang` `NeonGlyph`s), `InfoDot` (`ⓘ` → the new `info` glyph). Also **added the missing `info`
     glyph** to the family (the review's named gap) + `GlyphMark` for on-fill/crisp chrome marks.
   - **Slice 2 — DONE (PR #405):** the tappable controls whose only icon was an emoji — the `✕`
     close/clear/remove/dismiss taps (shared `DismissibleNote` + Paywall, TradeWizard, Players,
     DraftList, Trades, Compare, WaiverWizard), the `↑↓`/`▲▼` reorder glyphs (DraftList, WaiverWizard),
     and the `★`/`☆` pin (Leagues). Added `up` to the glyph family and a `fill` prop to `GlyphMark`
     (filled star = pinned). Left the `⇄`/`★` that appear inside COPY or labels (not controls).
   - **Slice 3 — DONE (PR #406):** the two `⇄` Shop/Trade pick buttons that were also tappable-only
     controls (PickInventory, Draft) → `swap` vector; and OnTheBlock's `◎`/`⊘`/`★` status markers →
     the existing `TargetIcon`/`AvoidIcon`/`WatchIcon` vectors (closes the target/avoid + watch/star
     cross-screen inconsistency for that screen).
   - **Slice 4 — DONE (PR #407):** the `⇄ Label` buttons → a flex-row of `swap` vector + `<Text>`:
     `Shop`/`Shopping` (shared PlayerRow + Portfolio ×3), `Trades` (Draft topbar + Roster), `Block`
     (TradeInbox topbar), `Propose trade` (OnTheBlock). Icon tint matches each label; the two topbar
     links keep their right-alignment via a `justify-flex-end` row (dropped the text's minWidth /
     textAlign onto the row). Pill buttons gained `flexDirection:'row'` + `gap`.
   - **Remaining (decorative, lowest priority):** the inline `▲▼`/`◆` trend indicators (Portfolio,
     Players, PlayerProfile), the small `⇄` bait-tag pills (Trades), and the `⇄`/`★` that appear
     inside explanatory copy or trade-activity strings (`A ⇄ B`) — content, not controls.

## P3 — Accessibility & remaining color hygiene (bounded)

6. **Sub-11px font floor (41 sites).** Bump readable tags/labels to `size.micro` (11) — e.g.
   Players "MINE" tag (9), Trades buildColLabel (10), Portfolio holdScope (10). Judgment call per
   site: leave fixed-geometry glyphs (avatar position letters at 9) that would overflow. Wants a
   build to confirm no badge overflow, hence P3 not a blind sweep.

7. **Sub-44 touch targets** (§9): back buttons ~40px (hitSlop only), sort chips ~26px, segmented
   controls ~32px (add `minHeight:44`), reorder/`✕` glyphs.
   - **DONE (PR #412):** the segmented-control tab switchers → `minHeight: 44` + `justifyContent:
     'center'` across DraftList, LeagueScreen, OnTheBlock, Players, Trades, Waivers, Portfolio — the
     primary navigation controls, now at the §9 touch minimum. (Reorder/`✕` glyphs already carry
     `hitSlop` from the P2 icon work.)
   - **Remaining (judge on the build):** the small sort/filter chips (`minHeight:44` visibly grows a
     horizontal chip row — decide on-device whether that reads as chunky), the ~40px back buttons, and
     unifying `PortfolioScreen`'s bordered-pill segmented control onto the shared inset-track idiom.

8. **Remaining small color-law leaks** (non-paywall).
   - **DONE (PR #408):** `EmptyView`'s bar defaulting to `gold` → `colors.textDim` (a neutral, matching
     the callers that already passed `tone={colors.textDim}`); Login gold DEMO **pill** → neutral
     border/text (a status badge isn't value). Both color-only, zero layout risk.
   - **DONE (PR #413):** DraftScreen gold *action* buttons → accent — the "Draft" confirm
     (`sheetBtnGo`) and the "My Draft List" nav (`listBtn`/`listBtnTitle`). Kept the on-the-clock /
     clock spotlight gold (that's value/state, correct per the doc).
   - **Held for the build:** the Login gold **title rule** (part of the brand lockup — a brand call,
     eyeball first). `Sparkline`/`Button` gold defaults are latent — leave but don't spread.

9. **Other consistency stragglers.**
   - **DONE (PR #408):** LineupEditor/LineupWizard header titles white → `colors.violetText` (they
     already use Oswald via `displayLg()`; only the color was off). Color-only.
   - **Remaining:** the TradesScreen reject modal is center-anchored where the house style is a bottom
     sheet (§10); several ad-hoc `Modal+View` sheets could adopt `BottomSheet` — layout changes, build.

## P4 — Deferred / not recommended as a sweep

10. **~1,300 mechanical token drifts** — `fontSize:13` (~150), `borderRadius:12` (~200), and the
    6/10/14 spacing family (~875). These are the workhorse values on nearly every screen.
    **Do NOT mass-rewrite** — high layout-churn risk for zero visible benefit. Options: (a) add
    `13` and `12` to the `size`/`radius` scales to bless the de-facto values, or (b) leave as
    slice-able cleanup applied only when a file is already being edited. The doc itself files
    these as deferred.
