# Usability backlog

Prioritized output of a per-screen PO **usability** review (task flow, hierarchy, discoverability,
feedback, copy, cognitive load) across all 32 mobile screens, grounded in code and triaged against the
app's own [`UX_GUARDRAILS.md`](UX_GUARDRAILS.md) (C1–C12). Ordered by user impact ÷ effort. All items are
mobile (ride an EAS build). Findings verified in code carry a ✓.

**What's already excellent — do NOT "fix":** the trust layer is consistently strong and honors the
contracts — optimistic writes with non-destructive revert (C3/C4), named confirms on the *truly*
irreversible paths (draft pick, immediate add/drop) while cancelable queued claims pass through, instant
on-device trade preview (C6), quiet degradation of one dead league (C5), priority lanes (C12), per-league
write scoping, FAAB/draftable labeling (C10). Reviewers flagged none of these; neither should future work.

---

## TIER 1 — Trust / data-loss / dead-ends (small fixes, high value)

1. **TradeInbox — "Reject & build your own ›" rejects the offer immediately, no confirm.** ✓
   `onManualCounter` fires `respond(item,'reject')` on tap (TradeInboxScreen.js:276) *before* the counter
   is even built — so a mis-tap on a low-emphasis link irreversibly declines an offer that may be "You
   gain value," while Accept double-confirms everywhere. Fix: don't reject on tap — let *sending* the
   counter reject the original (the desk already does this), or confirm first.
2. **WaiverWizard — "Next league ›" silently discards a built-but-unsubmitted claim.** The wizard
   pre-fills a recommended add/drop/bid so the step always *looks* filed; `nextLeague` just advances and
   marks the league 'skipped' with no guard (WaiverWizardScreen.js:296). A user who agrees with the
   recommendation and taps Next believes they filed it — across 15 leagues this drops real claims. Fix:
   confirm ("You haven't submitted this claim — skip anyway?") when a valid claim is unsubmitted.
3. **Profile — "Log out" fires with no confirmation.** ✓ It wipes the token + every cache and forces
   re-auth of all 15 leagues (C11), yet it's one tap (ProfileScreen.js:150) — while **"Delete my data"**
   two rows down *does* confirm. Add a confirm to match.
4. **Home — the most urgent numbers are dead text that looks tappable.** ✓ "Lineups to set / Holes /
   Injuries" render as `Chip`s with **no `onPress`** (HomeScreen.js:603–605), beside identical-looking
   tappable Tiles. A Sunday tap on "Lineups to set · 3" does nothing. Fix: wire them to the matching
   filtered action (e.g. Under Center), or restyle so they don't read as buttons.
5. **Lineups — the prominent CTA dead-ends into an alert.** ✓ When nothing needs attention the button
   reads "Review Lineups" (LineupsScreen.js:144) but is wired to `startWizard`, which finds no
   non-optimal leagues and just pops "All set" (60–64). Disable/hide it when the queue is empty.
6. **On the Block — ticking a checkbox looks committed but isn't; the header count lies.** The collapsed
   league header shows `{checkSet.size || lg.count} on block` from **unsaved** checks
   (OnTheBlockScreen.js:294), so after ticking three boxes it says "3 on block" though nothing was saved
   to MFL until "Save block" is tapped. Fix: header reflects *saved* state; make Save unmissable.
7. **LineupWizard — a mode change mid-step silently discards manual edits.** The load effect keys on
   `[leagueId, mode]` and hard-resets `assignments` to the mode's optimal, so tapping a different mode to
   compare wipes hand-edits with no warning. Preserve edits or prompt.

## TIER 2 — Broken cockpit / navigation / discoverability

8. **LeagueScreen — the "Waivers" chip tab-jumps and destroys the overlay stack.** ✓ (the code comment
   concedes it, LeagueScreen.js:42–49). Every other in-league chip opens a scoped overlay you can back
   out of; Waivers alone teleports to the global Waivers tab and Back won't return you — breaks the
   cockpit and C7. Fix: a league-scoped waivers overlay.
   ✓ RESOLVED: `WaiversScreen` gained an `onExit` prop → a league-scoped OVERLAY that lands on that
   league's board and backs out to the caller. Routed every in-league/overlay opener (league hub,
   roster, lineup-editor "Fill on waivers", on-deck) through it; the Home TAB keeps the tab jump.
9. **LeaguesScreen — no search/filter across ~15 leagues.** Finding one league is scroll-and-scan every
   time. Add a text filter (pin already floats favorites).
   ✓ RESOLVED: added a name search (shown once >6 leagues) with a Clear button and a "no match" empty
   state; filters the loaded list locally, pinned-first order preserved.
10. **Help — the ⓘ dots can't deep-link.** `HelpScreen` takes only `onBack`, no topic/anchor, so every
    ⓘ dumps the user at the top of the whole manual to hunt. Add a `topic` param + scroll-to.
11. **LineupEditor — "Optimize" is an easy-to-miss text link that silently overwrites every slot with no
    undo.** The headline value action deserves more affordance + a way back (it's recoverable only by not
    saving and backing out).
    ✓ RESOLVED: "Optimize" is now a bordered pill (not a bare text link); it toasts the points gained
    (no longer silent) and toggles to a reversible "Undo optimize" that restores the pre-optimize
    lineup. Any manual slot edit, save, or reload retires the Undo.
12. **LeagueScreen — 3 stacked horizontal scrollers hide actions.** Ribbon + action row + team-chip bar
    all scroll horizontally with no indicator; Waivers/Draft sit off-screen right undiscovered.
13. **DraftHub — no countdown on the on-the-clock rows,** so simultaneous drafts (the hub's whole reason)
    can't be triaged by urgency; the user must open each league to find the ticking one.

## TIER 3 — Density / cognitive load (larger product changes)

14. **Lineups — three overlapping "set my lineups" paths with labels that don't signal the difference,**
    and inverted emphasis (the guided wizard is the big button; the faster bulk auto-set is demoted to
    underlined text). This sits on the most-used weekly screen — the top structural issue.
    ✓ RESOLVED (owner decision, docs/LINEUP_FLOW_OPTIONS.md): cut to **two** clearly-labeled paths —
    the **wizard** (primary button, walks each flagged league from the optimal lineup, adjustable) and
    the **per-league editor** (tap a row; now signposted). The redundant bulk auto-set path + its review
    sheet were removed. Added an "OPTIMIZE FOR ⓘ" label explaining Auto/Safe/Balanced/Aggressive.
15. **Players — a four-row control stack** (Rank / Pos / Value-lens / Sort) pushes actual players below
    the fold, and **"Rank" conflates ordering mode with content filter** ("Rookies" empties the board;
    "Trending" just re-sorts — same chip row). Collapse into an expandable filter affordance.
16. **Roster — every player carries a permanent 3-chip move row** (→IR/→Taxi/Drop), turning "scan my
    team" into a management wall with an inline destructive Drop on every row. Collapse behind
    swipe/overflow/selection mode.
17. **Trades Propose builder — ~5 ways to fill a deal + up to 3 unreconciled value verdicts, and no
    one-line "is this a good idea?" at the moment of building** (the incoming OfferCard *has* a reconciled
    bottom line; the builder doesn't). Add the synthesis where the user commits.
18. **Portfolio — coupled lens toggles.** One By-value/By-shares toggle silently drives *two* cards
    (Allocation + Top holdings) while a visually identical toggle on Value-at-risk is independent.

## TIER 4 — Time-urgency & high-stakes screens

19. **Waivers — imminent leagues aren't floated to the top; the "imminent" styling is defined but never
    applied** (`ovCardImminent`/`imminentBadge` dead — proof it was intended). Sort/group `waivers_soon`
    by run time and wire the emphasis.
20. **Draft — "Avoid" rows are dimmed to `opacity:0.5`,** the exact pattern Waivers explicitly rejected
    (its comment: dimming "killed the name's legibility and tap affordance"). Use the color-wash instead —
    on the highest-pressure screen especially.
21. **Draft — the pool can reflow under your finger mid-poll.** The confirm sheet (which *names* the
    player) is the only thing preventing a wrong irreversible pick — keep it, and freeze pool order while
    a row's Draft is armed.
22. **DraftList — reordering is 4 tiny icon buttons, one step at a time** (no drag, no to-bottom). A
    drag handle is the expected interaction for a 30+ ranked list.
23. **PlayerProfile — Shop vs Drop show identical counts and overlapping models; Target/Avoid's ±10%
    effect is invisible** (explained only in a code comment; the value number doesn't visibly move).

## TIER 5 — Cross-screen consistency

24. **Verdict vocabulary drifts three ways** for one concept: desk/inbox "You gain value / give up value"
    (`favorable/fair/unfavorable`) vs TradeFinder "You win value / pay up" (`…/light`) vs PickTradeFinder
    (same words, `unfavorable` key). Unify wording + keys.
25. **"Remove a pending claim" has three verbs:** board "Delete", Pending tab "Cancel", wizard ✕→"Delete
    claim?". Pick one.
26. **Loading placeholder is split-brain:** `ListSkeleton` (OnDeck, League) vs a bare `ActivityIndicator`
    (Home, Scores, Leagues, Settings, and most overlays). Standardize on the skeleton.
27. **Persistent instructional paragraphs never dismiss** (Roster manage-hint, OnDeck explainer, Players
    free-agent intro, elsewhere) — vertical tax on the daily power user. Make first-run-only/collapsible.
28. **Login — no show-password toggle and no keyboard "return-to-submit"** on the app's single gate;
    the only feedback on a typo is a full round-trip error.
29. **Back-label + destructive-confirm patterns vary** ("‹ Back" vs "‹ Hub" vs "‹ {name}"; fixed-`width`
    back labels clip — `minWidth` is the fix LeagueScreen already uses).
</content>
