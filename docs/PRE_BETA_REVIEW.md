# Pre-Beta Review — Dynasty Central

A consolidated review ahead of the beta, synthesized from a five-agent deep pass (backend
resilience, mobile architecture/performance, tech debt, adversarial correctness, and beta/launch
readiness) plus an expert dynasty-fantasy **product-owner** pass (added in the second half of this
doc). File/line references are from the tip at the time of review; treat them as pointers, not exact
addresses after further edits.

---

## Live-testing status (owner, as of this review)

The owner has been testing against **real MFL leagues** — **draft, trade bait, trades, and waivers**
are exercised on live data (many of this session's fixes came directly out of that testing). This
de-risks the "never proven against a real account" assumption both the beta-readiness and product
passes originally led with. **Still unproven on a real account:** **Set-All lineup import** (the
headline paid feature) and **push-notification delivery on a device**; also worth measuring is the
full ~15-league cold-load time with all real leagues. Prioritize verifying those before external
testers.

---

## What's already solid (verified — don't re-litigate)

- **Throttle/429 architecture is coherent and correct.** Retry now lives at the read *source*
  (`lib/mflRepo.js` wraps ~18 read types in `withRetry`), so services call `mflRepo.*` and don't
  reinvent resilience. The global `lib/mfl.js` controls — per-account fair queue + an adaptive penalty
  that halves concurrency and quadruples stagger on the first 429 — address the *root* cause: a cold
  15-league fan-out no longer piles onto an already-throttled MFL.
- **Security invariants hold.** MFL password is never stored (app → backend → MFL; only the session
  cookie, AES-256-GCM encrypted at rest when `SESSION_SECRET` is set). No secrets committed. No
  `console.*` logs a cookie/password/token.
- **Bug-report path is beta-safe.** Session-gated; destination address is server-side env only and
  never returned to the client; response leaks nothing; no password/cookie enters the diagnostics.
- **Cache/data layer is sound.** SWR with instant repaint, non-destructive errors, the reload-vs-
  refetch spinner-flash fixes are live on all the flagged screens, and `api.js` now surfaces MFL's
  human-readable error detail.
- The `withRetry`/Superflex→2QB/`Button`-primitive debts from the prior review are **resolved**, and
  the "9 high-severity vulns" scare is a **non-issue** (dev-only `eslint` transitive; `npm audit
  --omit=dev` → 0).

---

## Tier 1 — Fix before beta (correctness + the perf issue behind the draft 429s)

### 1. Portfolio "movers" poison stored value history on a partial load — P1 (backend + mobile)
The aggregate portfolio trend is gated on partial cross-league loads, but the **per-player** movers /
`trend7` block still calls `pvHistory.record()` **unconditionally**. On a partial load a player's
value is summed over only the leagues that loaded (understated); `record` overwrites that calendar
day's stored point, **permanently corrupting** the series, and the movers card shows a fabricated
"▼ −40%" drop — directly under the banner that promises trends are hidden until all leagues load.
- **Where:** `backend/src/services/portfolio.js` (~L651, the per-holding record/mover loop) +
  `mobile/src/screens/PortfolioScreen.js` (movers card ~L233, top-holding trend arrow ~L884).
- **Fix:** compute `partial` before the loop; when partial, skip `record`, read the existing series
  for `trend7`, and return `movers: []`; gate the mobile movers card + trend arrow on `!totals.partial`.

### 2. Trades inbox silently drops real pending offers on a throttle — P1 (backend)
`trades.getOverview`'s per-league `catch` returns `{ offers: [], fit: null }` — unlogged and
**indistinguishable from "no offers here."** After the read's retries exhaust, a real pending offer
(and its expiry) vanishes from the inbox, On Deck, and the push. Worse, the same catch also wraps the
enrichment work that runs *after* the offers are fetched, so an enrichment throttle **discards offers
that already loaded**. This is the one hot path that never got the `status:'error'` honesty treatment
that drafts/portfolio/exposure already have.
- **Where:** `backend/src/services/trades.js` (~L398–448).
- **Fix:** move format/enrichment into an inner `try` so a failure there degrades enrichment but keeps
  the raw offers; on the outer catch `logDegrade` and return a `failed:true` marker; surface top-level
  `partial`/`leaguesLoaded` (mirror `exposure`).

### 3. Podium mis-assigns 3rd — and can mis-crown the champion — with consolation ladders — P2 (backend; introduced by the trophy-podium feature)
The playoff reconstruction collects *every* playoff-week matchup and classifies any non-championship
final-week game as the 3rd-place game (`thirdGames[0]`). A league running a consolation bracket in the
same final week can therefore get a **false bronze** — and a consolation final whose teams each won
their prior game reads as "undefeated," folding into the championship round and mis-picking the
champion. This feeds `trophies.detect`, so a false podium finish can be auto-added to a user's case.
- **Where:** `backend/src/services/playoffs.js` (~L155–186).
- **Fix:** constrain reconstruction to the franchises named in the championship bracket definition
  before classifying weeks, and identify the 3rd-place game via the definition that matches
  `/3rd|third|consol/` rather than "any non-undefeated final-week game."

### 4. NavTools bug-neon runs up to 6 perpetual flicker loops on hidden tabs — P2 (mobile; introduced by the nav-tools feature)
`<NavTools/>` renders on all six tabs and the bug sign is `grade="ailing"` → a never-ending
`Animated.loop`. Under keep-alive, tabs stay mounted (`display:none`), and native-driven animations do
**not** pause for hidden views — so once all tabs are visited there are six identical infinite opacity
loops running forever, a continuous wakeup cost for a decorative beta affordance. (Reduce-motion is
correctly honored.)
- **Where:** `mobile/src/components/NavTools.js`, `NeonSign.js` (ailing loop), `App.js` keep-alive.
- **Fix:** gate the ailing loop to the **active** tab (pass an `active`/`covered` prop the loop
  respects), or hoist the bug sign into a single shared header layer rendered once above the tabs.

### 5. Live-draft poll re-fetches the ~2000-player free-agent pool every 5 min — P2 (backend)
On a 15s poll the only guaranteed refetch is `draftResults` (shared cross-user), **but every 5 minutes
a poll also re-issues the heavy 2000-player free-agent read** (+ rosters + adp) — during MFL's busiest
window. This is the amplifier behind the repeated in-draft 429s. During an active draft the pool only
*shrinks*, and `assemblePool` already subtracts the `drafted` set.
- **Where:** `backend/src/services/draft.js` `getLeague` (~L554–627) / `fetchPoolInputs`.
- **Fix:** fetch the free-agent pool once at draft start and pin it for the draft's duration (or raise
  its TTL while `status === 'in_progress'`), leaving `draftResults` as the sole recurring read. Board/
  pool assembly is pure CPU and can re-run each poll for free.

### 6. Trophy case: one throttled league blanks the whole case — P1-adjacent (backend)
`trophies.detect`'s fan-out has **no per-league catch**, so one league where `championFor` throws
rejects the entire `Promise.all` — exactly the quiet-degradation failure `mapLeagues` exists to
prevent.
- **Where:** `backend/src/services/trophies.js` (~L123–140).
- **Fix:** route the fan-out through `lib/safe.js mapLeagues` with a `[]` fallback.

---

## Tier 2 — Should fix around beta (hardening + a correction)

> **Status:** #8, #9, #10, #11, #12, #13 done. #12's shared `mapLeaguesSettled` + `partiality`
> envelope now lives in `lib/safe.js` and scoreboard adopts it — which also fixed a latent false-
> `partial` in the offseason (a no-live-game league is now `ok:true/value:null`, distinct from a
> throttled `ok:false`, so an empty board no longer reports "some leagues failed"). The helper is
> available for the remaining fan-outs to adopt as they're touched. **#7 deferred** — changing shared
> retry semantics across ~10 call sites is risky without load-testing, and #5 (pinning the draft pool)
> already cut the in-draft 429s that made the sustained-throttle hang likely. Revisit if cold-load
> hangs recur.

7. **Un-over-layer the draft retries.** Retry lives at the read source now, so the outer `withRetry`
   wraps recently added to `getLeague`/`getOverview` partly double up; and `withRetry` retries
   *non-transient* errors too, so a genuine failure can stretch a cold load to 10–20s. Make `withRetry`
   bail on `!e.transient` and trim the redundant outer wraps (keep coverage for the few reads that
   bypass `mflRepo`). `backend/src/lib/retry.js`, `services/draft.js`.
8. **Bug-report hardening.** A dedicated per-endpoint rate limit (the global 600/min is loose for
   email), an `AbortController` timeout on the webhook `fetch` (a hung webhook holds the request open),
   and a client-side scrub so diagnostics can't accidentally carry a token. `routes/bugReport.js`,
   `lib/mailer.js`, `mobile/src/bugReport.js`.
9. **`playerValueHistory` key growth.** A key per player ever held drifts toward the ~2000-player
   universe across a churny season and risks the 5 MB persist latch. GC keys whose last point is older
   than N days. `backend/src/store/playerValueHistory.js`.
10. **Home dead code.** Unused `topActions`/`gearBtn`/`avatarBtn`/`avatarHead`/`avatarBody` styles +
    dead `onOpenProfile`/`onOpenSettings` props and their pass-through, left by the NavTools move.
    `mobile/src/screens/HomeScreen.js`, `App.js`.
11. **BugReportSheet over-promises "recent in-app activity."** The breadcrumb ring is fed only by the
    crash handler, not navigation/API. Either wire `recordEvent` into tab changes + the api catch, or
    soften the copy. `mobile/src/components/BugReportSheet.js`, `src/bugReport.js`.
12. **Standardize partial-failure surfacing.** Add a `mapLeaguesSettled` envelope
    (`[{leagueId, ok, value, error}]`) so every fan-out computes `leaguesLoaded`/`partial` the same way
    — `scoreboard` also silently drops failed leagues today. `backend/src/lib/safe.js`.
13. **Perf polish (mobile).** Memoize the `NavToolsProvider` value + handlers (`useMemo`/`useCallback`)
    so an App re-render doesn't reconcile 6×3 neon trees; unify the absolute-vs-inline NavTools header
    placement behind one primitive.

---

## Tier 3 — Owner actions & post-beta polish (not blocking code)

**Before a closed testing track:**
- Host Terms & Privacy at real URLs and set `EXPO_PUBLIC_TERMS_URL` / `EXPO_PUBLIC_PRIVACY_URL` /
  `EXPO_PUBLIC_SUPPORT_EMAIL` — today the in-app legal rows are dead links and "Delete my data" is a
  `mailto:` to an unregistered domain. Fill the `[SUPPORT EMAIL]`/`[EFFECTIVE DATE]` placeholders in
  `docs/play-store/TERMS.md` + `PRIVACY_POLICY.md`.
- Set a bug-report delivery transport in Render (`BUG_SMTP_URL`+`BUG_REPORT_TO` or
  `BUG_REPORT_WEBHOOK`) — see `docs/BUG_REPORTS.md`. Until then reports persist server-side.
- Confirm `SESSION_SECRET` is set in Render so "encrypted at rest" holds if session persistence is on.

**Before charging (launch):**
- Decide + document server-side Pro enforcement — gates are cosmetic today (write routes check session
  only, not entitlement). Wire RevenueCat. Sign FantasyCalc + RotoBaller commercial terms. Build a real
  data-deletion path (purge session + per-account stores by `accountKey`) to honor the Data-safety
  promise.

**Consolidation (safe, no behavior change — whenever):**
- ~~Three "across" sheets~~ **DONE.** `AddAcrossSheet`/`TradeAcrossSheet`/`TradeBaitSheet` now share a
  `BottomSheet` shell + a `Checkbox` primitive. (Went with `Checkbox`, not a full `CheckRow`: the row
  layouts genuinely differ — TradeBait nests the check in a header row with a `LeagueContext` block
  below — so a mega-row would over-abstract.) Adopting the bounded shell also **fixed a latent overflow
  bug in AddAcrossSheet** (its list was unbounded and could push the title off the top edge, the same
  bug TradeAcross already had).
- ~~Adopt-or-delete `SectionLabel`~~ **DONE** — deleted (nothing imported it); `DESIGN_SYSTEM.md §4.4/§7`
  corrected to describe the real per-screen `displayLabel()` + `violetText` treatment.
- ~~Delete dead components `HubMark.js`, `LeagueCard.js`, `ProLock.js`~~ **DONE.**
- ~~Dedup the neon/theme palette (medal colors forked in both)~~ **DONE** — `neon.js` now derives its
  tube colors from `theme.js` (`colors` + `rgb`, with silver/bronze/textDim triplets added there), so
  the palette has one source. `fontWeight:'900'`→`weight.heavy` token sweep (~174 sites) is **still
  open** — deferred for a build-time visual pass.
- ~~Fix the stale `useCachedResource.js` header comment~~ **DONE** (rewritten to the keep-alive model).
- ~~`PlayerProfileScreen` `DropSheet`~~ **DONE** — adopted the shared `BottomSheet` + `Checkbox` (the
  latter gained a `color` prop for its red destructive check), which also fixed its unbounded list
  (now scrolls in the bounded sheet) and added the a11y checkbox role.

---

## Product-owner pass (expert dynasty-fantasy review)

*Companion to the technical review above. A features-and-flows pass from the seat of a dynasty power
user who runs 15 leagues and has churned through Sleeper, DynastyGM/Nerds, KTC, FantasyCalc, and
Fantrax. Read-only; no code changed.*

### Verdict up front
This is **not** a single-league app with a switcher — the cross-league plumbing is real and it's the
best thing here. Home triage, Portfolio, exposure, Set-All lineups, the cross-league Waiver Wizard, the
player hub's add/drop-across-leagues, the watchlist, and On-the-Block all reason over *all* your leagues
at once, not one-at-a-time. Two features genuinely say something **no other dynasty tool can say**:
**cross-league arbitrage** ("you value Player X at 58 in League A and 41 in League B — sell in A") and
**cross-league exposure** ("you're 40% Bijan across 6 leagues — one hamstring wrecks your week
everywhere"). That's the moat. The risk to beta is not the vision — it's that (a) parts of the live MFL write path
are still unproven against a **real account** (see the Live-testing status note above — draft, trade
bait, trades, and waivers ARE validated live; **Set-All lineups and push delivery are not**), and (b)
the paid line rides on a values feed the app is contractually **not allowed to sell against yet**.

### Where it's already strong (don't re-litigate)
- **The cockpit is a real cockpit.** The Command Center's outlook donut + Under-Center count +
  per-league triage is exactly the "one screen instead of 15 tabs" promise, wired to actual cross-league
  fan-outs, not mocked.
- **Portfolio is the hook, and it earns it.** Value-over-time, position allocation, value-at-risk (hurt
  starters + aging cores), top holdings summed across leagues, and **arbitrage** — the screen a power
  user opens daily and can't get anywhere else.
- **The trade brain is ahead of the field.** Win-now-vs-dynasty lens that flips based on *that team's*
  outlook, two-sided construction verdicts, counters that respect construction, tag-biased suggestions,
  and **format-aware pick values** (an SF 1.01 isn't priced like a 1QB pick). Most competitors do none
  of this cross-league.
- **Format awareness is table-stakes-complete:** SF/2QB, TE-premium, PPR, and league size all move
  value; taxi/IR/FAAB/trade-deadline/waiver-run windows are all read from MFL.
- **Data honesty is a competitive weapon.** Partial-load notes, "N of M leagues loaded," and value-
  source attribution are more disciplined than most commercial apps. Keep it.
- **The free/paid line is cleanly drawn and documented** (reads free; act+automate Pro; a few personal
  writes stay free; on-the-clock alerts free so you never paywall a missed pick).

### Core value prop — where it lands vs. under-delivers
- **Lands:** the *daily/weekly* cross-league workflow — triage → Set-All lineups → cross-league waiver
  run → portfolio glance. 30 minutes of tab-juggling collapsed to one screen. That's the magic.
- **Under-delivered — the trade *finder* is reactive, not proactive.** Today you seed a deal from a
  target and the app helps build it. The dynasty dream is the inverse: **"Here are the 4 fairest deals
  available right now across all your leagues, ranked by how much they help each roster's window."** The
  app already computes every ingredient (needs/surplus, both outlooks, format value, trade bait).
  Surfacing it as a standing cross-league feed would be the single most differentiated thing to ship.
- **Under-delivered — value trust is single-sourced.** Everything hangs on FantasyCalc. Power users are
  tribal about values (KTC vs FC vs their own). The ±10% Target/Avoid tag is a nudge, not control. Some
  testers bounce the first time a FC number offends them.
- **Under-delivered — offseason/prep mode is thin.** No rookie rankings/tiers, no startup value board,
  no devy. In-season the app is strong; the moment football stops, a dynasty addict's attention goes to
  rookie prep and startups — and there's nothing here yet.

### Feature gaps a dynasty manager will immediately miss
- **Rookie draft board with rookie-specific tiers** (already tracked as unbuilt). Its absence is
  conspicuous — every dynasty app has it.
- **Startup/devy value boards** — off-thesis for beta but the two most-requested long-term.
- **The two weekly notifications that matter most are missing:** *injury to one of your starters* and
  *waiver results cleared*. A dynasty manager wants "your RB1 is doubtful, 3 leagues affected" and "you
  won Player X in 2 leagues, lost in 1" more than almost anything. (Draft-clock, trade-offer, lineup-
  attention, and watchlist alerts already exist.)
- **In-season playoff-push mode.** Standings/seeds + a bracket screen exist, but no cross-league "who's
  alive / win-and-in / already eliminated (go full sell)" roll-up — the in-season sibling of the outlook
  donut, and it drives real behavior.
- **A "rebuild plan" nudge.** You classify each team Win-now/Ascending/Rebuilding/Balanced — the payoff
  is telling a rebuilder *what to do* ("here are the vets to sell and their best market"). Today the
  label is a dead-end insight in several places.

### UX / onboarding / first-run (a 15-league power user's first 5 minutes)
- **The cold load is the first impression, and it's your scariest moment.** A 15-league fan-out is the
  product's opening act. Set the expectation explicitly ("Loading all 15 leagues — this is the slow
  part, once") and make sure the demo→real transition doesn't strand a new user.
- **Onboarding must teach the free/Pro model up front,** or free users experience the paywall as a
  bait-and-switch. One clean line: "See everything free. The 7-day trial unlocks acting across every
  league — after that, reading stays free." It's a *reverse* trial (full Pro for 7 days) — say so.
- **Which leagues are dynasty?** MFL managers mix dynasty, redraft, and best-ball. The app assumes
  dynasty framing everywhere (outlook, aging cores, pick value). A redraft league getting a "core age"
  verdict erodes trust. Detect or let the user flag league type.

### Monetization fit
- **The line (read-free / act-paid) is right for dynasty** — the cockpit hooks you, and *acting* is the
  recurring habit worth money. But the wow is in the **free reads**; conversion rides the **weekly act
  pain**, not the one-time wow. Telegraph time saved during the trial ("15 lineups set in 20 seconds,"
  "cleared 6 leagues' waivers without leaving this screen").
- **The single feature most worth paying for is one-tap Set-All + the cross-league waiver run** — the "I
  never open 15 MFL tabs on Sunday morning again" line item. Lead the paywall with the time-saver, not
  the (trust-gated) trade brain.
- **BLOCKER before charging:** FantasyCalc's ToU is non-commercial; a paid release needs their written
  permission (`LICENSING_OUTREACH.md`), and there's no fallback value source wired. Product gate, not
  just legal.
- **Server-side Pro enforcement is cosmetic today** (client gates only). Fine for a free beta with
  enforcement off; must be real before taking money.
- **Pricing ($44.99/yr, $7.99/mo)** is sane — under DynastyGM's stack, above impulse. Holds only if
  value trust holds; single-source unverified values are the churn risk at that price.

### Competitive positioning — what must be great to win a power user
1. **The Sunday-morning cross-league act run (Set-All + Waiver Wizard) must be visibly faster than by
   hand.** The wedge no one else owns for MFL — it has to feel like a cheat code.
2. **Portfolio + arbitrage must be trustworthy and only-here.** Your identity and your best screenshot.
3. **The trade brain must respect *your window*** — make the win-now-vs-dynasty-by-outlook logic legible
   so users feel the app knows they're contending in League A and tanking in League B.

**Table-stakes gaps to name honestly:** rookie rankings (missing), a second/own value source (missing),
and the strategic one — **MFL-only caps the TAM hard.** Sleeper is the dominant dynasty platform; most
15-league managers have leagues on both. MFL-only is a *defensible beachhead* (MFL power users are
underserved), but it's a ceiling, not a moat. Own the MFL niche first, know that's the conversation.

### Beta-specific priorities & riskiest assumptions
- **Riskiest remaining:** the live MFL write paths NOT yet exercised on a real account. Login,
  `myleagues`, rosters, **draft pick, trade propose, trade bait, and waiver file are live-validated by
  the owner** (this session's draft/waiver/trade fixes came out of that testing). Still unproven live:
  **Set-All lineup import** (the headline paid feature) and **push-notification delivery on a device**.
  Verify both end-to-end on a real account before external testers touch them — a Set-All that mis-sets
  a lineup, or notifications that never arrive, would each kill trust fast.
- **Validate willingness-to-pay for *automation specifically*.** Watch whether trial users convert on
  the weekly act loop or just read free and act manually in MFL.
- **Measure real cold-load times at 15 leagues** with real testers, not the demo fixture.
- **Get feedback first on the three trust pillars:** (1) do the values feel right, (2) is Set-All
  trustworthy enough to fire without hand-checking every lineup, (3) does the trade verdict match gut.
- **Push delivery is unverified on a real device** — the notifications you're selling must actually
  arrive.

### Ranked recommendations for beta

**Must-have for beta**
1. **Prove the remaining live MFL write paths on a real account** — draft/trade/trade-bait/waiver are
   owner-validated; **Set-All lineups and push delivery are not**, and Set-All is the headline paid
   feature. A mis-set lineup or a no-show notification on day 1 kills trust before feedback starts.
2. **First-run that teaches read-free / act-Pro + the reverse trial, and sets the cold-load
   expectation** — otherwise the paywall reads as bait-and-switch and the 15-league load reads as broken.
3. **Make Set-All + the cross-league waiver run *feel* like a time machine, and telegraph time saved
   in-trial** — the one payable feature a power user misses the instant it's gone; conversion lives here.
4. **Detect/flag league type (dynasty vs redraft)** — dynasty framing on a redraft league silently
   torches trust with the exact users you're courting.

**High-value soon**
5. **Proactive cross-league trade finder** ("fairest deals available now, ranked by each team's window")
   — you already compute every input; the most differentiated screen you could ship.
6. **Injury-to-starter + waiver-cleared notifications** — the two weekly alerts a dynasty manager wants
   most; neither exists yet.
7. **Value-source trust: a stronger tag tier and/or a second/importable source** — single black-box FC
   values are the churn risk against a $45 price and an opinionated audience.
8. **In-season playoff-push roll-up** ("alive / win-and-in / eliminated → sell") across leagues.
9. **Rookie rankings with rookie-specific tiers** — table stakes; the first "wait, where's…" a tester
   hits.

**Later bets**
10. **Sleeper support** — the real TAM unlock, but off-thesis; win the MFL niche first.
11. **Rebuild/contend action plans** — turn the outlook label into "here's who to sell/buy."
12. **Startup + devy value boards; pick-value-over-time / trade-history ledger** — offseason depth, not
    beta-blocking.

**Non-product gates before charging (flagged, not scheduled):** FantasyCalc commercial permission (or an
alternative value source) and real server-side Pro enforcement. Neither blocks a free beta; both block
the paywall.

---

## Product must-have status (build pass)

Where the four PO "must-have for beta" items stand after the build pass:

1. **Prove the live MFL path** — OWNER ACTION (can't be automated). Draft/trade/trade-bait/waivers are
   validated; **Set-All lineups + push delivery** are not. Actionable checklist added:
   [`docs/BETA_LIVE_TEST.md`](BETA_LIVE_TEST.md). **This is the top pre-beta gate.**
2. **First-run teaches the model + cold-load** — DONE. `WelcomeModal` now carries a phase-accurate
   model point: while Pro enforcement is off it explains the beta (everything unlocked + how to report
   bugs via the bug sign); when `ENFORCE_PRO` flips on it switches to read-free / act-Pro + the reverse
   7-day trial. Cold-load expectation was already covered.
3. **Set-All feels like a time machine** — DONE (lighter version). The Set-All completion now telegraphs
   the cross-league leverage ("N lineups set in one tap · +X pts") instead of a flat "N updated." A
   season-long "time saved / actions taken" stat (a stronger trial-conversion lever) is a later build.
4. **Detect/flag league type (dynasty vs redraft)** — DEFERRED, needs a decision. `myleagues` doesn't
   carry a keeper/dynasty flag, and inferring it from other MFL settings is fuzzy — **mis-detecting a
   dynasty league as redraft would suppress the app's best features (outlook, pick value, aging cores),
   which is worse than the current over-application.** So this needs a deliberate choice before building:
   **(a)** best-effort auto-detect from the `league` export (keeper settings / roster continuity) with a
   conservative default to "dynasty," or **(b)** a per-league user flag ("this is a redraft/best-ball
   league") stored server-side, threaded into the services that emit dynasty framing. (b) is safer and
   matches the PO's "detect OR let the user flag"; both are a medium build touching every dynasty-framing
   surface. Recommend scoping as its own feature, not a rushed slice.
