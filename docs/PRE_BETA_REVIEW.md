# Pre-Beta Review — Dynasty Central

A consolidated review ahead of the beta, synthesized from a five-agent deep pass (backend
resilience, mobile architecture/performance, tech debt, adversarial correctness, and beta/launch
readiness) plus an expert dynasty-fantasy **product-owner** pass (added in the second half of this
doc). File/line references are from the tip at the time of review; treat them as pointers, not exact
addresses after further edits.

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
- Three "across" sheets (`AddAcrossSheet`/`TradeAcrossSheet`/`TradeBaitSheet`) → shared `BottomSheet` +
  `CheckRow` (~250 of ~414 lines).
- Adopt-or-delete the dead `SectionLabel` and fix `DESIGN_SYSTEM.md §4.4` (which claims it's done).
- Delete dead components `HubMark.js`, `LeagueCard.js`, `ProLock.js`.
- Dedup the neon/theme palette (medal colors now forked in both); `fontWeight:'900'`→`weight.heavy`
  token sweep (~174 sites, needs a visual pass).
- Fix the stale `useCachedResource.js` header comment (still describes the pre-keep-alive unmount model).

---

<!-- PRODUCT-OWNER PASS APPENDED BELOW -->
