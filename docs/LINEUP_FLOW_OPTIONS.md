# Lineup flow — redesign options (for review)

From the usability review (Tier 3, the top structural item). This proposes concrete options; no code
changed yet. Pick a direction and I'll build it.

> **DECISION (owner):** Keep exactly **two** clearly-labeled paths and drop the redundant third (the bulk
> "Auto-set all leagues" → review sheet). The two kept: **(1) the per-league editor** — tap a league row to
> see what's set and hand-adjust it; **(2) the wizard** — a primary button that walks each flagged league
> one at a time, each defaulted to the optimal projected lineup, adjustable before submit. Shipped: removed
> the bulk auto-set path + `ReviewSheet`, relabeled the wizard button with a one-line explainer, added an
> explicit "tap a league to review & adjust" signpost for the editor, and an "OPTIMIZE FOR ⓘ" popover that
> spells out Auto/Safe/Balanced/Aggressive (on the Lineups screen and inside the wizard).

## The problem (today)

`LineupsScreen` offers **three** ways to set lineups, and nothing tells you which to use:

| Path | Entry (today) | What it does | Emphasis |
|---|---|---|---|
| **Editor** | tap a league row → `LineupEditorScreen` | hand-build ONE league's starters; has "Optimize" | (implicit) |
| **Wizard** | "Set Lineups · N to review" (big accent button) → `LineupWizardScreen` | step through each flagged league, eyeball/tweak, submit per league | **primary** |
| **Auto-set** | "Auto-set all leagues" (underlined text) → in-screen `ReviewSheet` | see every proposed change, uncheck any, apply all at once | demoted |

Three real issues:
1. **Two parallel "set all my lineups" paths** (Wizard vs Auto-set) with no signpost of the difference.
2. **Inverted emphasis** — the guided, slower Wizard is the big button; the faster bulk Auto-set is
   underlined text, for a persona whose #1 need is speed.
3. **Mode inconsistency** — the Auto/Safe/Balanced/Aggr mode toggle drives the Wizard and Auto-set, but
   the **Editor ignores it** ("Optimize" uses the server default), so the same league optimizes to a
   *different* lineup depending on the door you came through. And nothing explains what Safe/Aggr mean.

Underneath, there are really **two axes** the three paths blur:
- **Bulk vs per-league** (set all at once, or walk one at a time)
- **Trust the optimizer vs hand-edit** (apply the recommendation, or arrange it yourself)

Auto-set = bulk + trust. Wizard = per-league + can hand-edit. Editor = single + hand-edit.

---

## Option A — One button, review-first (recommended)

**Collapse the two bulk paths into one "review-first" flow; fold the Wizard's per-league control into it.**

- The single primary CTA becomes **"Review & set — N lineups · +Z pts"** → opens the review surface (today's
  `ReviewSheet`, promoted). You see every proposed change (IN/OUT/+pts), pre-checked; uncheck what you
  don't want; one tap sets the rest. This IS "set all," but never blind.
- Each row in the review gets a **"Tweak ›"** affordance → opens `LineupEditorScreen` for that league (hand-edit),
  then returns to the review. So per-league control (the Wizard's whole value) becomes an opt-in *inside*
  the one flow, not a second parallel path.
- Tapping a league **row** on the main list still opens the Editor directly (deep single-league edits).
- **Retire `LineupWizardScreen`** as a separate entry (its per-league review = "Tweak" in the review).

Screens: `LineupsScreen` (CTA + list), `ReviewSheet` (grows a Tweak affordance + becomes the hub),
`LineupEditorScreen` (unchanged, now reachable from the review too). `LineupWizardScreen` deleted.

- **Pros:** one mental model ("Review & set"); review-first is safe; hand-edit still one tap away;
  removes the biggest confusion (two bulk paths) and the inverted emphasis; fewer screens to maintain.
- **Cons:** larger build; the review sheet becomes the center of gravity (should probably become a full
  screen, not a bottom sheet, once it carries Tweak); losing the "one guided league at a time" feel some
  cautious users may like (mitigated: Tweak gives per-league control on demand).
- **Effort:** M. **Risk:** M (touches the core weekly flow — verify on a build).

## Option B — Two clearly-labeled intents (smallest change)

**Keep both bulk paths, but signpost them and fix the emphasis.**

- Primary accent button: **"Set all optimal · +Z pts"** → the Auto-set `ReviewSheet` (the fast path,
  promoted to primary).
- Secondary, equal-weight outlined button: **"Review one by one"** → the Wizard (guided).
- A one-line helper under each ("apply the optimizer's picks in bulk" / "walk each league, tweak as you
  go"), and an InfoDot on the mode toggle explaining Safe/Balanced/Aggr.
- Row tap → Editor, unchanged.

Screens: `LineupsScreen` only (button styles + copy + a helper line). Wizard/Editor/ReviewSheet untouched.

- **Pros:** minimal, low-risk; keeps both flows for users who prefer each; ships fast.
- **Cons:** still two paths (inherent redundancy stays) — better labeled, not simpler; doesn't resolve
  the two-axes blur.
- **Effort:** S. **Risk:** low.

## Option C — Progressive single screen (most ambitious)

**Make the Lineups screen itself the review.** When leagues need attention, each flagged row shows its
proposed change inline (IN/OUT/+pts) with a checkbox; a sticky footer reads **"Set N selected · +Z pts."**
No separate sheet, no separate wizard. Tapping a league **name** opens the Editor for deep edits; the
**checkbox** includes it in the bulk apply. "Set all" = check-all + tap.

Screens: `LineupsScreen` absorbs the ReviewSheet's content; `LineupWizardScreen` retired; Editor unchanged.

- **Pros:** the diff is always visible (not hidden behind a button); one screen does everything; no modal
  chains; the strongest "cockpit" feel.
- **Cons:** biggest redesign of the most-used screen; the row now carries two tap targets (name vs
  checkbox) — needs careful hit-target design; more to get right on a blind build.
- **Effort:** L. **Risk:** M–H.

---

## Cross-cutting fixes (do in whichever option)

- **Make the Editor mode-aware** (or show which mode "Optimize" used), so a league optimizes the same way
  regardless of entry door.
- **Explain the modes** — an InfoDot or one-liner on Auto/Safe/Balanced/Aggr; "Aggr" is also truncated,
  spell it "Aggressive."
- **Editor "Optimize"** is a top-bar text link that silently overwrites every slot with no undo
  (usability backlog Tier 2) — give it more affordance + a way back.

## Recommendation

**Option A.** It removes the actual root cause (two parallel bulk paths + inverted emphasis) rather than
papering over it, keeps the safety of review-first, and preserves per-league hand-editing as a one-tap
opt-in — while deleting a whole screen. If we want a fast, low-risk win *now* and a bigger rethink later,
ship **Option B** first (an afternoon) and treat **A** as the follow-up. **C** only if we want the Lineups
screen to become a true single-surface cockpit and can eyeball it across a couple of builds.
</content>
