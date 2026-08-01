# Single-League Cockpit — Review & Roadmap

A four-agent expert dynasty-fantasy **product-owner** review of the single-league flow (login → Home →
league switcher → everything inside one league), commissioned because the owner found that *for the
times you know you have one thing to do in one league, the app is slower and clunkier than just using
MFL for that league.* Grounded in the code (file/line refs are pointers from the review, treat as
approximate after edits). Panels: **action reachability**, **speed**, **UX/UI**, **PO vision**.

---

## Verdict up front

**The single-league experience is split across two disconnected screens, and the switcher lands you on
the wrong one.**

- **`LeagueScreen.js`** (`overlay type:'league'`) — the read-only hub you reach from the league
  switcher: **Standings / Rosters (scout all teams) / Transactions + a Bracket button.** It is passed
  only `{ league, onBack, onOpenPlayer, onOpenPlayoffs }` — **none** of the action handlers — so it
  **cannot launch a single action, and never even shows *your* roster or lineup.**
- **`RosterScreen.js`** (`overlay type:'roster'`) — *your* team in one league: roster value / core age /
  outlook, IR & taxi moves, per-player trade-bait toggle, launch buttons for Draft + Trades. Reached
  from **Home / Portfolio / On Deck** — **never from the league switcher.**

So "I have one thing to do in League X" → Leagues → tap the league → **a read-only standings shell with
no actions**, while the actionable "my team" screen hides behind a different entry point. That's the
clunk.

**The good news:** almost every action screen is *already* `leagueId`-scoped and *already* takes a
`league` prop (`RosterScreen`, `LineupEditorScreen`, `TradesScreen`, `WaiversScreen`, `DraftScreen`,
`DraftListScreen`, `PickTradeFinderScreen`, `PlayoffBracketScreen`). **The cockpit is ~80% a
wiring-and-IA problem, not a build-from-scratch problem.** The single biggest change is passing
`LeagueScreen` the handlers `App.js` already defines.

---

## What's there vs. what's missing (action reachability)

Every dynasty action a manager needs in one league, and whether it's reachable *from the single-league
hub* today:

| Action | In `LeagueScreen`? | Scoped-to-league screen exists? | Notes |
|---|---|---|---|
| Standings | ✅ | — | `StandingsTab` |
| Scout opponents' rosters | ✅ (read) | — | `RostersTab` (all teams) |
| Transactions feed | ✅ | — | `TransactionsTab` |
| Playoff bracket | ✅ (topbar) | `PlayoffBracketScreen(league)` | already wired |
| View a player | ✅ | `PlayerProfileScreen` | cross-league profile |
| **My roster (starters/bench/picks)** | ❌ | ✅ `RosterScreen(league)` | only from Home/Portfolio/OnDeck |
| **Set / optimize lineup** | ❌ | ✅ `LineupEditorScreen(league)` / `LineupWizardScreen([league])` | Lineups tab, re-scope |
| **IR / taxi moves** | ❌ | ✅ `RosterScreen` (`api.moveIr`/`moveTaxi`) | inside RosterScreen only |
| **Trade bait / on-the-block** | ❌ | ✅ `RosterScreen` per-player toggle | OnTheBlock is cross-league, no `league` arg |
| **Propose trade** | ❌ | ✅ `TradesScreen(league,'propose')` | Trades tab, re-scope |
| **Accept / reject / counter / withdraw** | ❌ | ✅ `TradesScreen` inbox/sent tabs | |
| **File / cancel waiver / FAAB claim** | ❌ | ⚠️ `WaiversScreen(initialLeagueId)` | **tab-switch that wipes the overlay stack** — ejects you from the hub |
| **Add / drop free agent** | ❌ | ⚠️ via waiver board only | no standalone add/drop; tab-only |
| **Draft board / make a pick** | ❌ | ✅ `DraftScreen(league)` | |
| **Draft list / queue** | ❌ | ✅ `DraftListScreen(league)` | only reachable *inside* DraftScreen |
| **Pick shop/acquire (finder)** | ❌ | ✅ `PickTradeFinderScreen(leagueId)` | only from cross-league PickInventory |
| **My matchup / live score this week** | ❌ | ❌ | `ScoresScreen` is cross-league only — **a real feature gap** |

**The two genuine structural gaps** (everything else is wiring):
1. **Waivers is a tab, not an overlay.** `openWaivers` clears the overlay stack and switches tabs
   (App.js:349-353) — a hub "Waivers" link would eject the user. Filing FAAB/add-drop scoped to a
   league needs a league-scoped **overlay** path (a `case 'waivers'` in `renderOverlay` + an
   `openWaivers` variant that *pushes* instead of tab-switching).
2. **"My matchup this week" isn't reachable in-context** — Scores is cross-league only.

---

## The cockpit vision + target IA

`LeagueScreen` becomes **the league's cockpit**: you land on *my team and what needs me in THIS league*,
with every action one tap away, and the cross-league brain (values, outlook, needs/surplus, win-now
lens, arbitrage-in-context) layered on as the edge MFL can't match. It absorbs `RosterScreen`'s action
surface, keeps Standings/Scout/Transactions, and adds the missing launch points.

**The landing glance — "what needs me in THIS league".** Home already fans out
`leagueTriagePreferDevice(leagueId)` per league, returning `{ name, status, items, phase, dynasty,
tradeDeadline }` — `items` carries `trade_offer`/`waiver_pending`; `status` carries lineup-`unset` /
roster-`incomplete` / injured-`risk`; `dynasty` carries `outlook`/`atRiskPct`. **Call the same payload
for one league** and render a scoped version of Home's attention model at the top:
- A **status ribbon**: "Lineup not set · 1 trade offer · 2 injured starters" — each chip a deep-link
  into the matching scoped action.
- The team's **outlook chip** (Win-now / Ascending / Balanced / Rebuilding) + roster value + % at risk.
- A **trade-deadline countdown** when near (already computed).
- If clean: "Nothing needs you in this league" — the calm honesty Home already uses.

**Structure — my-team-first landing + a persistent scoped action row, not deep tabs.** Open on **My
Team** (what you came for 80% of the time). Above the segmented control sits an always-visible **action
row: Set Lineup · Trades · Waivers/Add · Draft · Bracket** (each a one-tap launch of an existing
`leagueId`-aware screen; Draft/Bracket appear only when the phase signal says so). Reframe the segments
to **My Team | Standings | Scout | Moves**, My Team default. The current read-only tabs are kept but
demoted below the headline.

---

## Speed — make the single-league open lightning-fast

Today opening a league is a **cold network read behind a bare spinner** (the screenshot): the default
Standings tab's key is never primed, so `useCachedResource` takes the cold path; `data` stays `null`
(spinner up) until the *entire* `standingsPreferDevice` promise resolves. It can hang because the read
queues **behind the switcher's own NORMAL `api.portfolio()` 15-league fan-out** in the account's FIFO
lane (Fix A only demoted the *Home warm*, not the switcher), plus device-timeout stack-up and 429 tax.

**Biggest lever — prefetch the tapped league's hub so it paints instantly.** In `LeaguesScreen`
`onOpenLeague`, fire `standingsPreferDevice(leagueId)` (+ `leagueTeamsPreferDevice`) the instant the row
is pressed and `primeResource('league:standings:<id>', …)`; the ~250ms nav animation overlaps the
fetch, so `LeagueScreen` mounts to a warm `store.peek` hit → **instant paint, no spinner.** Also warm
**pinned** leagues' `leagueStandings`/`leagueTeams` in the `warmHome` LOW-priority queue.

Supporting wins, in order:
1. **`bg()` the switcher's portfolio enrich** (`LeaguesScreen` `loadEnrich`) so the badge fan-out drops
   to the LOW lane and stops head-of-line-blocking the standings read. Badges fill a beat later anyway.
2. **Skeleton, not a bare spinner** — replace the three `<ActivityIndicator size="large">` fallbacks
   with the existing `ListSkeleton`; **partial-paint Standings** (render names from the franchise
   directory immediately, fill W-L/PF when the standings read lands).
3. **Right-size device-vs-backend for a *single* foreground league** — the device path's per-IP relief
   is marginal for one league yet adds an 8s-timeout failure mode + a backend enrichment hop; prefer the
   **backend** (cross-user shared cache) for the single-league hub, or at least shorten
   `DEVICE_FETCH_TIMEOUT_MS` for these interactive reads.
4. **Keep-alive tabs + longer stale tier** so tab ping-ponging stays pure-cache and Rosters/Transactions
   can warm while Standings is on screen.

---

## UX/UI — the "serious love" pass

The screenshot defects are cheap, and the fixes use components that **already exist and are unused
here** (`ListSkeleton`, `EmptyView`, the theme tokens).

**P0 (screenshot-visible):**
- **Back button wraps** ("‹ League" / "s"). `styles.back` hard-codes `width:66` on `"‹ Leagues"` at 16px
  semibold with **no `numberOfLines={1}`**. Fix: drop the fixed width (or widen to ~80), add
  `numberOfLines={1}`, `minHeight:44` + centered (currently ~40px, under the 44 touch min), and an
  `accessibilityLabel`. Consider a chevron-only affordance to give the title room. Delete the dead
  `styles.title`.
- **Bare spinner on a blank body** → `ListSkeleton` (Standings gets a standings-shaped skeleton). This
  is a direct DESIGN_SYSTEM §10 violation ("never a lone `ActivityIndicator` for a list load") and is
  exactly the "slow, empty" first paint the owner reacted to — perceived-perf win even before the real
  prefetch lands.

**P1 (guardrail violations):**
- **Sub-tabs unmount on switch** (`{tab==='rosters' ? <RostersTab/> : null}`) → roster filter/sort and
  scroll reset every time (brushes UX **C7**). Fix: keep-alive (`display:none`), same model the top-level
  tabs use.
- **Segmented control off-spec** — active segment is a `cardAlt` fill with plain-white text, **no accent
  tint** (DESIGN_SYSTEM §10 mandates one accent-tinted control); add `accessibilityRole="tab"`.
- **Bare one-liner empty states** (`styles.empty`) → `EmptyView` (icon + title + line + CTA); Standings
  has no empty state at all.

**P2 (substance + polish):**
- **Make first paint a real landing** (the attention ribbon + your rank/record/PF hero + quick actions)
  — turns the read-only shell into "where I stand + what I can do here."
- **Motion** — wrap the first screenful in `Reveal` (staggered, capped) and make rows `PressableScale`
  (UX **C8**); route segment/label text through `displayLabel()` (Oswald).
- **Color-law smell** — the **Bracket** affordance uses a **gold** trophy glyph as *wayfinding*; gold is
  reserved for value. Tint the glyph `accent` to match its (already-accent) label, or commit to gold
  only if framed as a championship/value destination.
- **Token sweep** — the whole StyleSheet uses raw literals (fontSize 11/13/14/16/17, radius 10/12,
  padding 6/8/16) → `size`/`radius`/`space`/`weight` tokens.

Already correct (preserve): error states use the shared `ErrorView` with retry + pull-to-refresh
(never a dead end); standings column headers stay `textDim` per the data-grid exemption; the topbar
title ignites via `useNeonIgnite`.

---

## MFL parity + where we beat MFL

**Parity gaps to close:** (1) the cockpit doesn't exist as a single surface; (2) **"my matchup / live
score this week in this league"** isn't reachable in-context. Everything else (my franchise page,
submit lineup, FA add/drop, propose/manage trades, waivers/FAAB, IR/taxi, standings/playoffs, player
pages) is a **wiring exercise** over screens that already exist and already scope to a league. League
chat/message board is absent — acceptable to skip for beta (MFL owns social).

**Where the app is clearly BETTER for one league** (the reason to use it over MFL):
- **Value on every player, everywhere** (roster, wire, trade builder) — MFL shows none.
- **Win-now lens made local** — the cockpit knows *this team is a contender/rebuilder* and colors every
  suggestion by that window.
- **Two-sided needs/surplus trade verdict on-device** (instant preview) — MFL can't.
- **Arbitrage-in-context** — the killer scoped feature: on a player's row in *this* league, "you value
  him 58 here but hold him at 41 in League B — sell high here." The cross-league moat as a single-league
  superpower.
- **One-tap lineup optimize**, device-live standings/rosters/transactions, aging-core / value-at-risk.

---

## Prioritized roadmap

### Tier 0 — the cockpit (mostly wiring; ship as one coherent change) → reaches single-league parity
1. **Point the switcher at a my-team-first cockpit + pass `LeagueScreen` the action handlers** it
   already can't see (`openRoster/openLineup/openTrades/openDraft/openBlock`, defined in App.js). Add a
   **My Team** default view (fold in `RosterScreen`'s content or launch it). *Highest-leverage change.*
2. **Add the scoped action row** (Set Lineup · Trades · Waivers/Add · Draft · Bracket).
3. **Add the attention ribbon** from `leagueTriagePreferDevice(leagueId)` (reuse Home's item model,
   scoped; chips deep-link).
4. **Fold IR/taxi + trade-bait into the cockpit roster.**
5. **Unify entry points** — Home/Portfolio/OnDeck route to the one cockpit, not the bare `RosterScreen`.
6. **Speed pair (ship with Tier 0):** prefetch-on-tap in `LeaguesScreen.onOpenLeague` + `bg()` the
   switcher's portfolio enrich + `ListSkeleton` fallbacks. This is what makes it *feel* like MFL.
7. **P0 UX:** fix the header wrap; keep-alive sub-tabs.

### Tier 1 — close the last parity gaps
8. ✅ **"My matchup this week" in the cockpit** — DONE. Scoped `GET /api/leagues/:id/matchup` reuses the
   scoreboard card; `MatchupCard` renders in-season above the ribbon, taps to Set Lineup.
9. **League-scoped Waivers overlay** so FAAB/add-drop don't eject you to a tab; make plain add/drop read
   as "add a free agent to this team." *(Deferred: write path — wants an on-device pass.)*
10. ✅ **In-cockpit trade inbox entry** — DONE (chip-level). The action row's Trades/Waivers chips carry a
    live pending-count badge from triage (`trade_offer`/`waiver_pending`), no new screen.
11. **P1/P2 UX:** segmented control to spec, `EmptyView`, motion, token sweep, Bracket color-law.

### Tier 2 — the dynasty-intelligence differentiators (why you'd pick the app over MFL for one league)
12. **Arbitrage-in-context on the roster** — per-player "worth more/less in your other leagues" tag.
13. ✅ **Win-now lens made actionable per team** — DONE. `roster.outlookPlan()` maps the outlook to a
    verb + directive + intent (contender shops / rebuilder acquires); the cockpit's plan chip taps to Trades.
14. **Opponent/matchup scouting for the week** (priced strengths/holes of who you play).
15. **Proactive single-league trade finder** — "fairest deals available in this league now, ranked by
    your window" (scoped sibling of the cross-league finder; inputs already computed).

### Sequencing
Tier 0 is nearly all reuse and is the difference between "clunkier than MFL" and "parity + faster" —
ship it first as one cockpit. It touches navigation + the `'league'` overlay, so it must clear the
UX_GUARDRAILS pre-merge checklist (C1 instant paint, C2/C3 throttle+invalidate, C7 scroll survival);
the cockpit leans on `useCachedResource` per sub-view exactly as the current tabs do, so it's low-risk.
The offseason window (now) is the right time per the motion roadmap's build phasing.

### Key files
- `mobile/src/screens/LeagueScreen.js` — becomes the cockpit (today a read-only shell).
- `mobile/src/screens/RosterScreen.js` — my-team content + IR/taxi + bait to fold in.
- `mobile/App.js` — the `'league'` overlay case must receive the action handlers already defined
  (`openRoster/openLineup/openTrades/openDraft/openWaivers/openBlock`); unify `openLeagueHub`/`openRoster`.
- `mobile/src/screens/LeaguesScreen.js` — switcher `onOpenLeague` (re-point + prefetch-on-tap + `bg()`
  the enrich).
- `mobile/src/screens/HomeScreen.js` — `warmHome` LOW queue: add pinned-league standings/teams warms.
- `mobile/src/mflDevice.js` — device-vs-backend choice + timeout for the single-league hub.
- `leagueTriagePreferDevice` (mflDevice.js, consumed in HomeScreen) — the attention-glance data source,
  already built.
- Reuse-ready, no changes needed to scope: `LineupEditorScreen`, `LineupWizardScreen`, `TradesScreen`,
  `WaiversScreen`, `DraftScreen`, `DraftListScreen`, `PickTradeFinderScreen`, `PlayoffBracketScreen`.
