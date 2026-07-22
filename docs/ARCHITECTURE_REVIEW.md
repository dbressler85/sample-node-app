# Architecture & Security Review

Third-party senior-architect review of Dynasty Central — Expo/React Native (SDK 51) mobile
app + Node/Express MFL-aggregation backend, ~20k LOC, no TypeScript. Read-only; no code was
changed to produce it. Companion to [`ROADMAP.md`](ROADMAP.md) and
[`UX_GUARDRAILS.md`](UX_GUARDRAILS.md) (which flags which of these carry UX risk).

**Bottom line:** the foundations are genuinely strong — a thoughtful MFL request throttle
with promise-level coalescing, layered TTL memoization, per-league error islands, mostly
virtualized lists, and a correct security core (no Critical/High exploitable issue found).
The debt is **structural, not sloppy**: a hand-rolled navigation model that forces the whole
state/cache layer to fight it; business math duplicated across the client/server line; and a
process (no lint, no CI test gate, no type checking) that lets the one bug class the team
most fears slip through — as it already has (`mfl.js:289`).

**Method:** eight parallel read-only deep-dives — five architecture/performance (mobile
architecture, mobile performance, backend architecture, backend performance, cross-cutting)
plus three security (auth/session/tenancy, transport/SSRF/injection/DoS/deps, mobile client).
Highest-severity claims were spot-verified against source: the login `ReferenceError`, the
verbatim trade-math duplication, the `.env` drift, the SSRF host-derivation + `redirect:'follow'`,
and the username-derived account key are all confirmed.

Legend — severity: **High** / **Med** / **Low**. Effort: **S** ~hours · **M** ~days · **L** ~week+.

---

## Do this week — all small, all real

1. **Fix the live-login crash.** `backend/src/lib/mfl.js:289` does `err.detail = snippet` but
   `snippet` is never declared (the in-scope variable is `hint`). Any *real* failed MFL login
   (bad password, IP block, 5xx) throws a `ReferenceError` → the user gets an opaque **500**
   instead of a clean 401 + hint. Invisible today only because demo mode never reaches it and
   no test covers the live path. **[S, verified]**
2. **Add a security allowlist for the SSRF surface** (see S-1) — `redirect:'manual'` +
   `*.myfantasyleague.com` host check. **[S–M]**
3. **Add ESLint (`no-undef`) + Prettier + a CI job running `npm run smoke:all` on PRs.** No
   linter and no CI test gate exist anywhere — merges deploy straight to Render unverified,
   and the documented `no-undef` rule is unenforceable prose. Catches item 1 for free. **[S–M]**
4. **Glob the live-test registry.** `scripts/smoke-live.js` hand-lists 50 test names but the
   directory holds 58 files — any harness a dev forgets to register never runs and never fails,
   and they've already drifted. Replace the array with `readdirSync(...).filter(...)`. **[S]**
5. **Bound the MFL client's read cache.** `mfl.js`'s `readCache` Map is only pruned on
   failure/overwrite — a never-re-requested key lives for the whole process lifetime. Add the
   size-triggered sweep the memo/leagues caches already use. Slow leak in an always-on process. **[S]**
6. **Resync `.env.example`** — it documents `MFL_MIN_REQUEST_INTERVAL_MS=500` but the code
   default is `150` (3.3× slower if copied). **[S, verified]** · Assert `MFL_DEMO_MODE=false`
   in prod (demo mode defaults ON and accepts any credentials). · Mobile: `android:allowBackup=false`.

---

## The structural bets — highest value, larger effort

### 1 · Stop rendering overlays *instead of* tabs — adopt a real navigator · High · L · mobile
`App.js` is a hand-rolled router with two uncomposable dimensions (a `tab` string + an
`overlayStack`). `render()` returns an overlay *instead of* the tab layer, so opening any
detail screen **fully unmounts the active tab** and hides the tab bar; switching tabs unmounts
the previous one. Tab history isn't a stack (back from a deep tab jumps to Home), and
`openWaivers` (`App.js:219`) wipes the whole overlay back-stack. **This single choice is the
reason the caching layer exists**, and it drops FlatList scroll position on every round-trip —
which no cache can restore. Adopt `@react-navigation` (bottom-tabs + per-tab stacks); screens
are already clean prop-driven leaves, so it also deletes ~20 drilled `onOpenX` callbacks.
Highest-leverage change in the codebase.

### 2 · Collapse three overlapping cache layers + five load patterns onto one store · High · L · mobile
State lives in three places with no single owner: an in-memory `mem` Map (`useCachedResource`),
disk `AsyncStorage` (`cache.js`), and per-screen module snapshots (`homeCache`). The same key is
written through *different subsets* of layers by different screens; invalidation runs through
*two* parallel pub-sub buses; 24 screens load data five different ways (shared hook / raw
`getValue+setValue` / bare `useState+useEffect` with no cache / a private `useTab` hook / mixed
within one screen). Move to `@tanstack/react-query` + an AsyncStorage persister — it *is*
mem+disk+throttle+dedupe+invalidation as one system, and retires all three bespoke systems. Do
it alongside the navigator (same untangling). **⚠️ UX-sensitive — see UX_GUARDRAILS C1–C4.**

### 3 · Kill the trade-math duplicated across the network boundary · High · M · shared
`mobile/src/screens/TradesScreen.js:81`'s `analyze()` is a byte-for-byte copy of backend
`services/trades.js:102` — including magic thresholds (`net>5 && ratio>0.12`) and the
`{target:1.1, avoid:0.9}` tag modifiers; `constructionOf()` re-implements the backend's
`tradefit`. The instant one side is tuned, the client's live preview contradicts the server's
authoritative verdict on the same deal. No shared package binds the trees. Extract the pure
functions + thresholds into a `shared/` package; import from both. **[verified]** **⚠️ Keep the
pure fn client-side — see UX_GUARDRAILS C6.**

### 4 · Schema at the client/server boundary + an MFL repository layer · High · M · backend
Two stringly-typed seams with nothing verifying them: (a) `api.js` assumes response shapes
wholesale — a renamed backend field passes all backend tests and silently breaks a screen;
(b) MFL's raw response envelope (`toArray(res.rosters.franchise)`) is parsed in ~7 services,
leaking MFL's shape everywhere. Add `zod` schemas at route outputs (drift fails a test, not a
screen — fail *soft*) and a thin `mflRepo` that owns the unwrap and returns normalized arrays —
also the seam to hang a demo data-source on.

---

## Architecture & structure

| Finding | Sev | Effort | Area |
|---|---|---|---|
| **Fat screens mix fetch + logic + presentation** — Trades 764, Waivers 750, Players 679 lines (~18 `useState`). Extract logic into hooks + pure `lib/` helpers. | Med | M–L | mobile |
| **HomeScreen reimplements the shared SWR hook by hand** (`HomeScreen.js:65–183`) — `homeCache` + manual throttle + in-flight guard + own invalidation. Fold into the store; Home's real need is a *composed* query. | Med | M | mobile |
| **`demoMode` branching smeared through every service, no seam** — 112 `config.demoMode` refs; demo/live interleaved into business logic. Inject a per-request data-source provider (hang off `mflRepo`). Biggest maintainability tax; defer until the repo layer exists. | Med | L | backend |
| **Inconsistent backend error handling — 3 idioms, silent MFL-detail loss.** catch-and-return-`[]` swallows the MFL error (an expired cookie shows "no offers" instead of prompting re-login). ~40 swallows log nothing. One `safe(promise, fallback, ctx)` helper. | Med | M | backend |
| **Persistence won't scale past one process** (`store/persist.js`) — whole-file rewrite, last-writer-wins, SIGKILL-in-debounce loses the write. Fine for solo; *document the constraint*, swap behind Redis/Postgres only if scale is needed. | Med | doc S / migrate L | backend |
| **Service graph is a mesh; invalidation reached via lazy `require()`** (trades↔playerhub, waivers→draft, watchlist→trades/draft). Optional: a tiny invalidation event bus. | Low | M | backend |
| **Loading/error/empty triad reimplemented per screen** despite a shared `ErrorView`. A single `<Async>` wrapper standardizes it. | Low | S | mobile |

---

## Performance & efficiency

| Finding | Sev | Effort | Area |
|---|---|---|---|
| **PortfolioScreen is the one genuinely non-virtualized long list** (`PortfolioScreen.js:91`) — a single `ScrollView`; "Show all holdings" maps the full ranked book (hundreds of rows at 15 leagues), each a `<Reveal>` with no `animate={false}`; every toggle re-renders the monolith + re-sorts the full book. → FlatList + memoized `HoldingRow` + `useMemo` sorts + cap `animate`. **⚠️ estimate row heights (C7/C8).** | High | M | mobile |
| **PlayersScreen derived-work every render** — `rankById` rebuilt each render (`:207`); `sortPlayers()` inline as FlatList `data` (new array identity every render); rows not `React.memo`'d. After paginating to 300+, every keystroke re-sorts the list. → `useMemo` + `React.memo`. | Med | S | mobile |
| **Cold start awaits the display font (~2.2s) before first paint** (`App.js:128`). Un-await the font; paint on session resolve. **⚠️ avoid the FOUT pop — see C9.** | Med | S | mobile |
| **Static full-screen SVG backdrop re-renders on every App state change** (`App.js:429`). `React.memo(FieldBackdrop)`. | Med | S | mobile |
| **Two backend serial waves that should be one** — `waivers.buildFreeAgents` (`freeAgents`→`projectedScores`, `:181`→`:192`) and `leagueformat.buildFormat` (`league`→`rules`, `:123`→`:132`). Wrap each in `Promise.all`. | Med | S | backend |
| **Watchlist & exposure over-fetch the full all-franchise roster** (`watchlist.js:38`, `exposure.js:21`) to extract data `myRosterLight` already provides — and it's a *different HTTP cache key*, so they never share the fetch. Give them a light "my players enriched" gather. | Med | M | backend |
| **Trades "fit" double-computed** — inline in `getOverview` (`trades.js:342`) + re-fetched by the client's `getLeagueFit` (`:847`). Client skips `getLeagueFit` where the overview already returned `fit`. | Low | S | backend |
| **HTTP cache key sensitive to param insertion order** (`mfl.js:199`) — `{L,FRANCHISE}` vs `{FRANCHISE,L}` = distinct keys → silent double-fetch. Sort keys (or key from a whitelist). | Low | S | backend |
| **Global throttle singleton shared across accounts** (`mfl.js:28–86`) — one account's fan-out (and any 429 penalty) throttles everyone. Key throttle state per host if multi-tenant. (Also a DoS angle — see S-2.) | Low | M | backend |

---

## Tech debt & engineering hygiene

| Finding | Sev | Effort | Area |
|---|---|---|---|
| **No CI test gate + no linter anywhere.** Five GitHub workflows, none run `smoke`. No eslint/prettier config (there are even `// eslint-disable` comments for a tool that isn't installed). The `no-undef` rule is already broken (the login bug). Add a required `smoke:all` CI check + ESLint + Prettier. Single highest-leverage process fix. | High | S–M | both |
| **Test strategy: integration-only, no framework, zero mobile tests.** 58 "live" tests are `spawnSync` scripts monkeypatching `global.fetch` — no assertion lib, no coverage. High-value pure math only exercised through stubbed HTTP. **Zero** mobile tests — against a codebase whose top fear is an uncatchable root-component `ReferenceError`. Adopt `node:test` for extracted pure functions; add `jest-expo` + one "every screen renders" smoke test. | Med | M | both |
| **Smoke suite is flaky by wall-clock date** — `season.js` uses `new Date()`; the demo smoke asserts in-season shapes (the "unavailable current starter" failure). Inject a fixed clock in demo mode. | Med | S | backend |
| **Business thresholds scattered & undocumented** while `config.js` centralizes TTLs beautifully — verdict thresholds `5/0.12`, FAAB factor, tradefit ratios encode product judgment and should be as visible/tunable. Named `constants/scoring.js` (ideally in the shared package). | Med | S | both |
| **Cross-league fan-out idiom copy-pasted; ~40 silent swallows uninstrumented.** A `mapLeagues(leagues, fn, fallback)` helper centralizes concurrency + telemetry. | Low | S | backend |

---

## Security — third-party security-architect pass

**Overall posture: strong. No Critical or High exploitable issue found.** The credential,
tenancy, and crypto core is done right — cookie↔token binding is structural (no client-cookie
path exists), tenant isolation is doubly enforced (membership check *plus* MFL's own cookie is
the real authorization), the MFL password never reaches storage or logs (verified end-to-end),
sessions are AES-256-GCM at rest, and the mobile client stores its token in the OS keychain
with zero device logging.

### Findings

**S-1 · SSRF — outbound host derived from upstream data, no allowlist, redirects followed · Medium · S–M · backend.**
`hostFromLeagueUrl()` (`mfl.js:295`) does `new URL(leagueUrl).host` with no validation; the URL
comes from MFL's `myleagues` response (`leagues.js:18`) and is interpolated into every outbound
request (`buildUrl`, `:109`) with `redirect:'follow'` (`:125`). A compromised/MITM'd MFL response —
or a crafted league `url` — can point requests at an internal/attacker host, and even an
allowlisted host returning a 302 is followed. *Mitigating:* transport is hard-coded `https://`
(so `http` metadata endpoints mostly fail) and undici strips auth on cross-origin redirects.
Low likelihood (needs MFL or TLS compromised), high impact. **Fix:** allowlist
`/(^|\.)myfantasyleague\.com$/i` in `hostFromLeagueUrl`/`buildUrl`; set `redirect:'manual'`. *The
single most valuable security hardening here.* **[verified]**

**S-2 · Process-global throttle → cross-tenant DoS · Medium · M · backend.** The 4-slot outbound
concurrency limiter (`mfl.js:28–86`) is one process-wide queue shared across all users — one
account's heavy fan-out monopolizes it, and one account tripping MFL's 429 puts the *entire*
server into penalty backoff. **Fix:** per-account concurrency cap. Irrelevant solo; matters the
moment it's multi-user. **⚠️ keep the single-account ceiling generous — see UX_GUARDRAILS §2.**

**S-3 · The `snippet` login bug, security lens · Low · S · backend.** The same `mfl.js:289`
ReferenceError also returns `{"error":"snippet is not defined"}` to the client (minor
internal-name leak) and was *intended* to echo MFL's raw login body via `err.detail` — avoid
echoing upstream bodies to the client even once fixed (keep them server-side-log-only). **[verified]**

**S-4 · App-local data keyed by the typed username, not MFL's authoritative identity · Low · M · backend.**
`sessions.js:100` — `acct:<submitted-username>`; all app-local data (tags, watchlist, trade bait,
pins, stores, push tokens) is namespaced by it. Safe in production, but **demo mode is the
default and accepts any credentials**, so a demo client can read/write another demo account's
data; also silently orphans data on email-vs-username or case-variant logins. **Fix:** key on the
authoritative `MFL_USER_ID` cookie (already extracted). **[verified]**

**S-5 · Mobile: API responses cached unencrypted at rest · Low–Med · S · mobile.** The SWR disk
cache (`cache.js:22`) writes rosters/portfolio/trades/league-names to plaintext AsyncStorage —
included in `adb`/cloud backups → readable on a rooted or backed-up device. **No token or
password is ever cached** (verified). **Fix:** `android:allowBackup="false"`.

**S-6 · Accept-with-documentation / small hardening · Low · S each.**
- **CORS wildcard** (`app.js:27`) — no CSRF risk (Bearer, no ambient credentials); allowlist only if a web client is added. **[verified]**
- **Password in MFL login query string** (`mfl.js:257`) — inherent to MFL's GET login; our stack never logs it. Accept/document.
- **Username in `state.json` plaintext** regardless of `SESSION_SECRET` — low-sensitivity PII, no credentials; document or hash the key, lock `DATA_DIR` perms.
- **Demo mode defaults ON** — add a startup assertion that prod sets `MFL_DEMO_MODE=false`.
- **Mobile:** scheme-allowlist the news `Linking.openURL` (`PlayersScreen.js:375`); set Android `usesCleartextTraffic:false` + assert `https`; no cert pinning is the correct call here.
- **Deps:** the committed lockfile resolves express 4.22.2 / path-to-regexp 0.1.13 / body-parser 1.20.6 (all above known-CVE thresholds); only risk is the stale `^4.19.2` floors drifting — ensure deploy uses `npm ci`; bump the floors.

---

## What's already strong — preserve it

- **MFL request layer.** Promise-level HTTP cache coalescing concurrent identical reads, a
  bounded-concurrency throttle with adaptive 429 backoff, TTL tiers (static/live/slow). This is
  what makes the many "redundant" service reads actually free when warm.
- **Layered memoization.** `enrichment.snapshot` collapses N leagues → ≤6 format keys with
  parallel providers; `gatherMemo`, `rosterMemo`, `faIdsMemo`, `draftOpenMemo`, a `computeRanks`
  WeakMap keyed on snapshot identity.
- **Smart gating.** Empty-inbox short-circuit before the expensive trade math; profile skips
  projections out of season; "slice-then-annotate" avoids resolving the whole player universe.
- **Most lists already virtualized** — Portfolio is the lone exception.
- **Security core.** Structural cookie↔token binding, double-layered tenant isolation, AES-256-GCM
  sessions at rest, MFL password never stored or logged (verified), 192-bit tokens, per-IP
  brute-force lockout. Mobile: keychain-only token, zero device logging, full logout wipe, no
  embedded secrets, no injection/eval/path-traversal, deps patched in the committed lockfile.
- **Docs + central error handler.** `CLAUDE.md`/`LESSONS.md` encode real hard-won rules; the
  Express handler correctly maps `err.status`/`mflError`→502 and surfaces `err.detail`. The gap is
  that the rules are enforced by prose, not tooling.

---

## Suggested sequencing

| Phase | Theme | Items | Effort |
|---|---|---|---|
| **0 · Now** | Stop the bleeding | Login-bug fix · **SSRF allowlist + `redirect:'manual'`** · ESLint + CI smoke gate · glob test registry · bound `readCache` · env-example resync · deterministic-clock smoke · assert `MFL_DEMO_MODE=false` · mobile `allowBackup=false` | All S |
| **1 · Foundations** | Untangle nav & state | react-navigation (overlays-on-top, real back-stack) → consolidate caches on react-query; delete `useCachedResource`/`homeCache`/`useTab` | L |
| **2 · Contracts** | Bind the seams | shared trade-math package · zod at API boundary · MFL repository layer | M each |
| **3 · Perf polish** | High-frequency wins | Portfolio virtualization · Players/backdrop memoization · cold-start font · backend serial-wave & over-fetch fixes | S–M |
| **4 · Coverage** | Make it testable | extract pure logic + `node:test` · mobile render smoke · standardize error handling + telemetry | M |
| **5 · Defer** | Only if it pays | demo/live data-provider seam · persistence scaling (document now) · per-host throttle · full TS migration | L |

> **A "Home does two serial fan-outs" finding was corrected during review:** traced to
> `portfolio.js:178/188` (not `dashboard.js`) and **downgraded** — the mobile app doesn't call
> `/api/home`; it loads Home via progressive per-league `leagueTriage`, so that endpoint's
> inefficiency barely matters and it may even be unused client-side (worth checking for removal).

> **Before starting Phase 1**, read [`UX_GUARDRAILS.md`](UX_GUARDRAILS.md): several items here
> (react-query semantics, the nav migration, the font-await, error-surfacing, moving trade math
> server-side) are UX wins only if implemented the right way, and can quietly degrade the
> experience otherwise. Do the wobble-prone work in the offseason, behind the test net from Phase 0.
