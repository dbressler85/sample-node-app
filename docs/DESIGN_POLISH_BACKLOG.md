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
     Cancel `ghost` / Add-trophy `primary`). 5 CTAs, 3 screens.
   - **Remaining (~13 CTAs):** Lineups:313/373, Trades:833/930/1043/1026/1054, Waivers:917/966,
     WaiverWizard:597 (submit sits in a flex row w/ a nav button — take care), PlayerProfile:553
     (drop → `destructive`), TradeInbox:387, Paywall:131 (keep the `gold` variant — brand
     exception), Login:194, Settings:150/162. Dead per-screen button styles from converted sites
     are left inert; prune in a later pass.

2. **Swap the ~18 bare first-load spinners for `ListSkeleton`** (§10 — "never a lone spinner for a
   list"). Start with RosterScreen:220 (named in the doc). Also PlayerProfile:183, Playoff:81,
   Trophy:164, PickInventory:57, DraftHub:84, Draft:351, TradeInbox:258, TradeFinder:59,
   PickTradeFinder:56, Leagues:166, DraftList:150, WaiverWizard:338, Portfolio:120, Lineups:112,
   Waivers:523/706, Home:386.

3. **Route the ~10 hand-rolled section labels through `displayLabel()`** so the eyebrow renders in
   Oswald everywhere (today it's Oswald on ~half the screens, system font on the rest). Sites:
   Roster:341/335, OnDeck:189, Trades:1221/1234/1287, WaiverWizard:784/813/834/854,
   Players:892/940, Waivers:1135/1166, League:428/434, OnTheBlock:471, TradeInbox:472/475,
   Scores:209. Then **pin the numeric contract** (size.caption 12 / ~0.16em) inside the helper or
   a shared style so the current size drift (10/11/12/13) can't recur.

4. **Give the ~15 bare `<Text>No X</Text>` empties to `EmptyView`** (§10). Sites incl.
   Trades:642, Players:442/485/512/536/596, Waivers:401/710/1038, DraftList:226/276,
   WaiverWizard:452/667, Portfolio:588, DraftHub:88, TradeInbox:284, PickInventory:61/72,
   Draft:392/454, OnTheBlock:352/380. Fold the "rich inline" empties (Scores:105, Playoff:90,
   Trophy:178) into `EmptyView` too so there's one treatment, not three.

## P2 — Iconography (tracked batch — DESIGN_SYSTEM.md §11)

5. **Emoji → vector icon migration (~46 sites).** Vectors already exist for nearly all of them
   (`x`, `check`, `swap`, `bolt`, `star`/`WatchIcon`, `target`/`TargetIcon`, `AvoidIcon`, `bang`,
   `trophy`, `search`, `dollar`, `tag`). Do highest-visibility first:
   - **Shared primitives that propagate everywhere:** `Checkbox.js:13` (`✓`), `Toast.js:24/26`
     (`✓`/`⚠`) — fixing these two touches every checkbox and toast in the app.
   - **Tappable controls whose only icon is an emoji** (~16): the `✕` close/clear taps, `▲▼`/`↑↓`
     reorder glyphs (DraftList, WaiverWizard), `★`/`☆` pin (Leagues:136).
   - **Cross-screen inconsistencies** (same concept vector-in-one-place, emoji-in-another):
     watch/star, target/avoid, swap/`⇄`, check. The trophy icon is the correct template — always
     the vector via `NeonSign`.
   - **Gap:** there is no vector `info` glyph (`InfoDot.js` uses `ⓘ`) — add one to the family.

## P3 — Accessibility & remaining color hygiene (bounded)

6. **Sub-11px font floor (41 sites).** Bump readable tags/labels to `size.micro` (11) — e.g.
   Players "MINE" tag (9), Trades buildColLabel (10), Portfolio holdScope (10). Judgment call per
   site: leave fixed-geometry glyphs (avatar position letters at 9) that would overflow. Wants a
   build to confirm no badge overflow, hence P3 not a blind sweep.

7. **Sub-44 touch targets** (§9): back buttons ~40px (hitSlop only), sort chips ~26px, segmented
   controls ~32px (add `minHeight:44`), reorder/`✕` glyphs. Also unify `PortfolioScreen`'s
   bordered-pill segmented control (1076) onto the shared inset-track idiom.

8. **Remaining small color-law leaks** (non-paywall): Login gold DEMO pill + gold title rule →
   neutral/structure; `EmptyView`'s accent bar defaulting to `gold` → a non-value hue; DraftScreen
   gold *action* buttons (600/681/647) → accent (on-clock/clock gold is correct, keep it);
   `Sparkline`/`Button` gold defaults are latent — leave but don't spread.

9. **Other consistency stragglers:** LineupEditor/LineupWizard header titles are white 24px (not
   the violet title treatment); the TradesScreen reject modal is center-anchored where the house
   style is a bottom sheet (§10); several ad-hoc `Modal+View` sheets could adopt `BottomSheet`.

## P4 — Deferred / not recommended as a sweep

10. **~1,300 mechanical token drifts** — `fontSize:13` (~150), `borderRadius:12` (~200), and the
    6/10/14 spacing family (~875). These are the workhorse values on nearly every screen.
    **Do NOT mass-rewrite** — high layout-churn risk for zero visible benefit. Options: (a) add
    `13` and `12` to the `size`/`radius` scales to bless the de-facto values, or (b) leave as
    slice-able cleanup applied only when a file is already being edited. The doc itself files
    these as deferred.
