# Architecture Re-Review — Device-Origin MFL Reads (July 2026)

Third re-review of Dynasty Central, triggered by the **device-origin read shift** that landed after
[`ARCHITECTURE_REVIEW_2026-07.md`](ARCHITECTURE_REVIEW_2026-07.md). Read-only; no code was changed to
produce it. Companion to that review, [`DEVICE_ORIGIN_MFL.md`](DEVICE_ORIGIN_MFL.md) (the design),
[`UX_GUARDRAILS.md`](UX_GUARDRAILS.md), and [`DATA_SOURCES.md`](DATA_SOURCES.md).

**Method:** five parallel read-only deep-dives, each *differently tasked* and each charged with
reconciling its findings against the prior two reviews — (1) backend architecture & scaling, (2)
security & privacy, (3) **device/backend parity & data-integrity** (a new dimension the shift creates),
(4) mobile architecture & UX-guardrail compliance, (5) performance & scaling. Every claim was verified in
code (`file:line`); the reviewers were told **not** to trust the design doc's status and to check the
implementation directly. The five converged with unusual consistency — the same core picture from five
angles.

---

## The reframe that governs everything

**The shift is fully built but dormant.** Device-origin reads are gated behind two flags that *both*
default OFF — `EXPO_PUBLIC_DEVICE_READS` (`mobile/src/config.js:19`) and `DEVICE_READS_ENABLED`
(`backend/src/config.js:49`) — though `mobile/eas.json:15` ships the mobile flag ON for device builds.
This is therefore a review of code that will ship **the instant the backend flag flips**, not of live
production behavior. Two immediate consequences:

- **`DEVICE_ORIGIN_MFL.md` still says "Design / proposal. Not yet implemented" — that status is stale**,
  as are two "the phone never talks to MFL directly" invariants (`mobile/src/config.js:3`, and the
  security summaries of both prior reviews). Doc drift is itself a finding: the next reviewer will trust
  false invariants. *(Corrected in `DEVICE_ORIGIN_MFL.md` alongside this review.)*
- **The July thesis is half-rewritten.** July's strongest claim was *"quota risk LOW by construction —
  every MFL call exits one backend IP, so the only exposure is latency through the global FIFO."*
  Device-origin **inverts** that: per-user foreground fan-outs now leave from each user's own IP + rate
  budget (`mobile/src/mflDevice.js:157-296`), so the cold-Sunday queue largely dissolves for the common
  case — but the "one throttled IP" *safety* property goes with it, and the exposure **relocates to the
  fallback path** and to **per-device politeness toward MFL**.

**The two shapes** (the crux of the whole review, from the parity dimension):
- **Shape A — "device ASSEMBLES":** `leagueTeams`/rosters, standings, transactions, exposure. The device
  builds the *final* payload via `mflRead.assemble*`; the backend fallback builds a **separate** payload
  via `services/league.js` / `services/exposure.js`. **Structurally divergence-prone.**
- **Shape B — "device FETCHES / backend AGGREGATES":** portfolio, draft, waivers (overview +
  best-available), pick-inventory, home-triage, lineups. The device fetches raw exports and POSTs them;
  the backend re-parses with the *same* `mflRead.reads.X.parse` it uses on its own fetch. **Structurally
  divergence-safe.**

Legend — severity **High / Med / Low**; effort **S** ~hours · **M** ~days · **L** ~week+.

---

## 1 · What stays the same (unchanged by the shift)

- **The security *core* holds.** Password never reaches the device (only the `MFL_USER_ID` cookie does,
  and only when `DEVICE_READS_ENABLED`, `backend/src/routes/command.js:22-25`); cookie is in SecureStore
  not AsyncStorage (`mobile/src/auth.js:22`), sent as a header never in a URL (`mobile/src/mflRead.js:199`),
  never logged, wiped on logout (`auth.js:52`). AES-256-GCM at rest, per-IP login lockout, token-gated
  `/_metrics` — all unchanged.
- **Writes and push-polling correctly stay backend** — cookie-authed, the hard-won padding /
  error-detail correctness intact (`backend/src/lib/mfl.js:465`, `services/notifications.js:249-260`).
  Device path is read-only.
- **Global feeds stay backend + cross-user shared** — player DB, `nflSchedule`, `injuries`, ADP,
  ownership. The device `reads` map is league-scoped only (`mflRead.js:94-187`).
- **July #1 (injuries share+warm) — stays and is now MORE central; already done** (`mfl.js:383`,
  `warm.js:61`). Injuries is one of the few things still on every backend roster/lineup build, so its
  share+warm is proportionally the single biggest remaining backend latency lever.
- **July #2 (extraItems parallelize) — stays, already done** (`portfolio.js:150`). The trade/waiver items
  are private reads excluded from device-origin, so they still run backend even on the device portfolio
  path.
- **Device-cache TTLs match the backend tiers exactly** (`mobile/src/deviceReadCache.js:19-29` vs
  `mfl.js:355-363`) — nothing is cached staler on-device just because it's local; any write clears the
  whole device cache (`mflDevice.js:17`). The "should we cache longer on device" question resolved
  correctly: staleness is keyed to the data, not the fetch site.
- **Shape B is divergence-safe by construction.** `mflRepo.rosters/assets/draftResults/freeAgents/…` are
  literally `mflRead.reads.X.parse(res)` (`mflRepo.js:30-33,70-79`), the identical parse the device runs,
  and rosters re-bucket through the same `assembleRoster` — so device-supplied raw is byte-identical to a
  backend fetch. Well-covered by cold-cookie, zero-backend-read parity tests.
- **July #13 (nav + dual-cache refactor) — remains a conditional DROP.** `deviceReadCache` is a
  legitimately *separate* tier (raw-read de-dup keyed `type+league+params`), not a fourth overlapping
  snapshot cache — it does not reopen the consolidation argument.

## 2 · What we shouldn't do now / becomes moot or downgraded

- **July #10 (warm-pass budgeting) — downgraded; re-scope, don't budget.** Warm primes *per-league*
  roster/FA/projection cache (`warm.js:30-41`) — but device users fetch those from MFL directly and never
  read those entries, so warming per-league now spends MFL quota for few hits. Don't budget a bigger
  per-league pass; **re-scope warm toward global feeds + fallback insurance** (keep the backend warm
  enough that a *fallback* lands on warm data).
- **July #12 (per-account throttle) — done; role narrows.** With foreground reads on-device, the only
  shared-IP per-user paths left are push-poll, warm, and fallback. Per-account fairness now matters
  specifically to keep one user's *fallback storm* from starving another's — smaller blast radius, still
  valid (`mfl.js:44-71,279`).
- **"Cold Sunday FIFO queue is the top risk" framing — downgraded** for device-served reads. The new
  leading indicator is not `throttle.queuedNormal`; it's the **beacon fallback rate**
  (`/_metrics` `mfl.deviceReads` reasons, `metrics.js:95-104`) — a fallback spike is when load re-lands on
  the backend.
- **The device-side SSRF vector the design doc worried about is moot** — the device targets a fixed
  constant host (`api.myfantasyleague.com`, `mflDevice.js:41` guarded by `isMflHost` `mflRead.js:78`), not
  the attacker-influenceable league `url`.

## 3 · What gets added

### 🔴 Two must-fix items before the flag is ever flipped

- **M-1 · C11 privacy gap — `deviceReadCache` is not wired into logout / auth-lost wipe · High · S · ✅ FIXED.**
  Both wipe paths (`App.js:180-188` auth-lost, `:208-217` logout) cleared disk, `homeCache`, the mem store,
  and SecureStore — but **not** `deviceReadCache`, which only cleared on *writes* (`mflDevice.js:17`). In a
  single process, a second account logging in before restart could get a **cache hit on the first account's
  parsed rosters** (up to the 5-min TTL, `deviceReadCache.js:19-29`). `UX_GUARDRAILS.md:111` C11 forbids
  adding a store without wiring the wipe. **Fixed:** `deviceReadCache.clear()` added to both wipe paths.
- **M-2 · Shape-A divergence, unguarded — and one case is a live bug · High · M · ✅ FIXED.** The four "device
  assembles" surfaces built the final object on-device while the backend fallback built a *different* one
  via separate services. Divergences, now closed:
  - `assembleTeams`/`Standings`/`Transactions` dropped top-level fields the backend returns
    (`format`, `name`, `leagueId`). **Fixed:** the assemblers now carry the same top-level fields, sourced
    from the franchise directory (`getFranchiseDirectory` now returns `leagueId`/`name`/`format`).
  - **`shapeRoster` read only `status`, not `status || roster_status`** — an IR/taxi player carried under
    `roster_status` mis-tagged as `active` on the device Rosters tab (a live silent bug). **Fixed:**
    `shapeRoster` now reads `status || roster_status`, matching the backend.
  - **Zero parity tests covered any Shape-A surface.** **Fixed:** `test/live/device-parity-shape-a-test.js`
    drives leagueTeams / standings / transactions through BOTH paths from one stubbed source and asserts
    byte-identical output (incl. a `roster_status` IR player pinning the slot fix).

### Before you flip the flag (high-value, corroborated across all five agents)

> **Status (2026-07-26):** ✅ done — **A-1** (device fan-out limiter, paced to the backend's registered
> 8/75 envelope via the handoff), **A-3** (registered UA), **A-4** (beacon key allowlist), **A-8** (draft
> missing-league fallback), **A-9** (covered-overlay polling — verified already gated by the keep-alive nav),
> **A-10** (heavy free-agent pool kept backend-only), **A-2** (partial-tolerant aggregates via `settlePool`),
> **U-1** ("complete/partial" affordance — already present on Portfolio, now reachable), **A-6 + U-6**
> (parser-version observability + sampled shadow-compare on `/_metrics mfl.deviceParity`), **A-12**
> (device-path unit tests — `preferDevice` extracted + covered). Accept-with-doc: **A-5** (cache erosion),
> **A-7** (cold-start), **A-11** (self-scoped trust). ✅ also done: **U-3** (fast offline fail + no
> beacon-storm), **U-4** (backend-independent Shape-A reads during a backend outage, via `deviceEnrichCache`),
> **U-5** (device-faster headline on `/_metrics mfl.deviceLatency`), **U-7** (expired-cookie → refresh, not
> silent fallback), **U-2 (partial)** — the highest-leverage slice: idle prefetch is now cellular-frugal
> (skips speculatively warming the heavy device-fan-out tab on cellular). **Every A-item is resolved or
> accept-with-doc; every U-item is done except the deferred U-2 remainder** (an explicit session read/byte
> budget — larger, diffuse payoff).

- **A-1 · Device omits the request discipline it was specified to mirror · Med · S · ✅ FIXED.** The device
  fired `Promise.all` across 15–20 leagues with **no stagger, no concurrency cap, no 429 backoff** —
  `pickInventory` = 3 reads × 20 leagues ≈ 45–60 simultaneous MFL requests. **Fixed:** every cross-league
  device fan-out now runs through `mobile/src/poolMap.js` — a bounded-concurrency + lightly-staggered map
  that mirrors the backend's own throttle shape **without** a per-call ~1s sleep (the PO's explicit warning
  — keeps first paint fast). The concurrency + stagger are **sourced from the backend** via the cookie
  handoff (`readConcurrency`/`readStaggerMs` = `config.mflMaxConcurrent`/`mflMinRequestIntervalMs`), so the
  device paces to the SAME per-IP envelope the registered backend runs (8 / 75 ms with the API key, not the
  unregistered 4 / 150 ms default) — and a re-tune or a higher registered limit follows with no app rebuild.
  Unit-tested (`test/poolMap.test.js`: cap never exceeded, order preserved, first-error rejects so callers
  keep backend fallback). (Adaptive 429 *penalty state* across fan-outs is still not ported — deferred with
  A-6. A single device-wide limiter across *concurrent* fan-outs — the exact mirror of the backend's one
  global queue — is a possible further refinement; per-fan-out pooling is sufficient given the app rarely
  runs two big fan-outs at once.)
- **A-2 · All-or-nothing aggregates re-concentrate load under stress (~2N amplification) · Med · M · ✅ FIXED.**
  One league's 429 rejected the whole device `Promise.all`, discarded every *successful* device read, and
  re-ran the full N-league fan-out on the backend FIFO (~2N reads under MFL stress). **Fixed:** the four
  aggregate fan-outs (portfolio, drafts, pick-inventory, lineups) now use a **settle** variant of `poolMap`
  (`settle: true` → per-item outcomes, never rejects) via `settlePool` (`mflDevice.js`): a failed league is
  dropped from the device map (successes kept), and only a *total* device failure throws for a clean
  whole-backend fallback. The backend aggregates already tolerate a partial map — portfolio marks missing
  leagues as placeholders and flags `totals.partial` (**U-1**); drafts/lineups/picks read just the missing
  league from the backend (per-league fallback, complete data). Amplification drops from ~2N to N (or
  N + the few failed). Settle-mode unit-tested (`poolMap.test.js`); the backend partial contract is already
  covered (`portfolio-dashboard-test.js:145-148`). (Exposure stays all-or-nothing — a Shape-A device-
  *assembled* view where a partial cross-league roll-up would be silently lossy.)
- **U-1 · "complete vs partial" freshness signal · ✅ ALREADY PRESENT (now reachable).** Portfolio already
  renders "⚠ N of M leagues couldn't load — this total is partial. Pull to refresh." from
  `totals.partial`/`failedCount` (`PortfolioScreen.js:164-168`), plus the `⚡ … · M leagues` device note.
  A-2 is what makes it *reachable* via the device path (before, the device only ever sent a complete map or
  fell back wholesale). Drafts/lineups/picks backend-fill missing leagues, so they have no partial state.
- **A-3 · Device sends a hardcoded UA, not the registered one · Med · S · ✅ FIXED.** `DynastyCentral/1.0`
  was hardcoded rather than sourced from the registered `config.userAgent`. **Fixed:** the cookie handoff
  (`GET /api/session/mfl-cookie`) now returns `userAgent: config.userAgent`, the device stores it in
  SecureStore with the creds, and `runDeviceRead` sends it (falling back to the default only for an older
  handoff). So on-device reads carry the same validated client identity the backend does.
- **A-4 · Beacon has an unbounded client-supplied map key · Low · S · ✅ FIXED.** `recordDeviceRead` keyed
  on the client `read` string with no allowlist/cap — an authenticated memory-growth vector. **Fixed:**
  the key is normalized against a fixed allowlist of the 11 known device-read names; anything else buckets
  to `(other)`, so the map stays bounded. Tested (`player-lookup-test.js`: a 500-char bogus name lands
  under `(other)`, never its own key).
- **A-5 · Backend cross-user cache erosion · Low · —.** Device data bypasses `exportRequest`
  (`portfolio.js:358`), so shared-cache hit rate falls and fallbacks trend cold. No correctness bug
  (invalidation intact both sides); a hit-rate/latency regression that makes A-2's fallback colder.
- **A-6 · The beacon cannot see *silent* divergence · Med · M · ✅ FIXED (with U-6).** It recorded only
  failures/latency, not "both paths returned different data." **Fixed on two axes, both surfaced under
  `/_metrics mfl.deviceParity`:**
  1. **Parser-version observability** — the shared core carries a `VERSION` (`mflRead.js`), the device
     reports it on every beacon, and the backend records the version distribution + a `staleClientReads`
     tally (beacons from a build OLDER than the backend). So a stale-app population — the one that could run
     old Shape-A assemble logic the backend can't see or correct (N4) — is now visible instead of silent.
  2. **Sampled shadow-compare (U-6)** — on a small sample (`config.deviceParitySampleRate`, default 2%) of
     device-origin portfolio reads, the backend re-fetches ONE league and compares the device-supplied
     rosters against its own (`lib/shadowParity.js`), recording `shadowSamples`/`shadowDiverged`.
     Fire-and-forget after the response, so it never affects the request; sampled so the extra read is
     amortized. Tested (`shadow-parity-test.js`: acceptance bar + recorder; version obs in `player-lookup-test.js`).
- **U-6 · Parity self-check with a product acceptance bar · ✅ FIXED (see A-6).** The shadow-compare uses the
  PO's bar: **STRICT on what the manager acts on** — roster MEMBERSHIP (which players) and each player's
  SLOT (active/bench/ir/taxi, via the same status→slot rule the screens use) — and **ignores** ordering and
  cosmetic status-string form. So it flags "the device thinks I roster a different player, or in a different
  slot, than the backend," not "the arrays are in a different order." The operator watches
  `deviceParity.shadowDiverged` / `staleClientReads` on `/_metrics` before and after flipping the flag.
- **A-7 · Cold-start latency regression · Med · —.** `deviceReadCache` is session-only
  (`deviceReadCache.js:31`), so every cold launch re-fans-out with no server-warm entry to lean on
  (freshness-neutral, latency cost). Reverses the prior review's central mitigation (warm loop + shared
  cache).
- **A-8 · Draft's missing-league branch silently returned `none` · Med · S · ✅ FIXED** (PO-elevated to
  must-fix — missed-clock risk). `draft.getOverview` refused a backend read for a league absent from the
  device map, so a newly-joined league one step ahead of the device's cached list vanished from the draft
  overview. **Fixed:** a league missing from the device map now falls back to a one-off backend read for
  just that league (every present league stays device-served); the test now asserts the fallback + real
  status instead of the old silent `none`.
- **A-9 · #11 (covered-overlay polling) · Med · M · ✅ ALREADY SATISFIED (verified).** The concern —
  a covered screen polling a device fan-out on the user's IP/battery — is already handled by the keep-alive
  nav: every poller gates on `covered`/`active` (`usePoll` also pauses when backgrounded), and the *only*
  cross-league device fan-out on a timer, DraftHub's `draftsPreferDevice()`, is gated `&& !covered`
  (`DraftHubScreen.js:41`); `covered` = "not the top of the overlay stack" (`App.js:475`), and the Scores
  tab poll is gated on `overlayStack.length === 0` (`App.js:257`). The other pollers (OnDeck, DraftScreen,
  Scores) are backend reads and gated too. C8 preserved — the *visible* top board keeps updating. No code
  change needed. (Residual from #11: each overlay still mounts its own `FieldBackdrop` — a pure render nit,
  not device-origin; left as a minor deferred perf item.)
- **A-10 · Heavy `freeAgents` pool fetched on-device, no wifi-gate · Low · S · ✅ FIXED.** best-available /
  waivers overview downloaded the full free-agent pool (thousands/league) for every league — a real
  cellular/battery cost. **Fixed by keeping the pool backend-only** (the review's + PO's call: fix the
  *cost*, not the *access* — never wifi-gate, "check waivers from the parking lot" must work on cellular).
  `bestAvailablePreferDevice`/`waiversOverviewPreferDevice` now resolve straight to the backend GET (with
  the `?format=` value lens intact); the device fetchers + the mobile POST helpers were removed. The pool is
  *league-shareable*, so the backend's cross-user cache serves it more cheaply than every device
  re-downloading it. The lighter per-user device reads (rosters/assets/draft) stay device-origin. (The
  backend still exposes the device-accepting POST variants + their parity tests, unused by the app — the
  capability is retained for a possible future trimmed-pool variant.)
- **A-11 · Backend now trusts device-supplied export content · Low · —.** POST routes pass `deviceReads`/
  `deviceRosters` through with no shape validation (`routes/draft.js:25-26`); self-scoped (a user can only
  feed bad data into their own read-only view), so low risk — but the backend read layer is no longer the
  sole authority on MFL data shapes.
- **A-12 · Testability gap on the device path · Low · S · ✅ FIXED.** The riskiest device logic was
  build-verified only. **Fixed** — the device path is now broadly unit-tested off-device:
  `poolMap.test.js` (fan-out concurrency + settle), `deviceReadCache.test.js`, `deviceHealth.test.js`
  (classification + offline cooldown), `deviceEnrichCache.test.js` (outage fallback), and now
  **`preferDevice.test.js`**: the orchestration was extracted into an injectable `preferDevice.js` so its
  fallback selection, `_source` tagging, beacon behavior (incl. network-suppression + version stamp), and
  the U-7 cred-refresh trigger are all covered with fakes + the real `deviceHealth`.

---

## Sunday-load risk — restated under device-origin

- **The cold-Sunday FIFO queue dissolves for the common case.** Foreground fan-outs run on device IPs, so
  `(concurrent users × cold leagues)` no longer serializes through the one ~6.6 req/s backend pipe.
- **The exposure relocates to the fallback path.** All-or-nothing aggregates (A-2) mean a single device
  429 mid-fan-out triggers a full backend fan-out (~2N reads), and under an MFL rate-limit event *many*
  devices fall back at once — reintroducing the July "latency is the real exposure" herd, now concentrated
  on fallback and landing on a *colder* backend cache (A-5, A-7). Quota stays safe (the backend throttle
  still makes it a queue, not a ban); latency is the cost.
- **Quota safety now depends on per-device politeness that isn't implemented** (A-1, A-3). The single
  throttled IP structurally guaranteed it before; device-origin traded that guarantee for first-paint
  latency and must earn it back with an on-device limiter.
- **What to watch on a real Sunday:** `/_metrics` `mfl.deviceReads` fallback rate + reasons (the new
  leading indicator), then the classic `throttle.queuedNormal` / `warm.lastRun.fetched` for the residual
  backend load.

---

## Per-dimension one-liners

- **Backend scaling** — thesis half-rewritten: foreground load distributed, but push-poll (unchanged),
  warm (re-scope, #10↓), and fallback (new pressure point) remain. Nothing became fully moot.
- **Security** — core intact; the "no client-cookie path" invariant is now false *by design* (a
  full-account cookie lives on each device — implemented with the right primitives, but a posture change
  to document, not stumble into). Real new risk is MFL politeness (A-1/A-3), not credential handling.
- **Parity (new dimension)** — Shape B safe and well-tested; **Shape A unguarded with a live
  `roster_status` bug + field drops + zero parity tests** (M-2). The headline correctness finding.
- **Mobile / UX** — competent, contract-aware; fallback transition is invisible (C4/C5 pass), `_source`
  badge is calm. One must-fix C11 wipe gap (M-1); #11 urgency up; #13 DROP holds; #14 fat screens got
  slightly fatter.
- **Performance** — dissolves the prior top risk for the common case, TTLs correctly matched; relocates
  exposure to fallback (A-2/A-5/A-7) and adds the device-politeness gap (A-1).

---

---

## 4 · Product/UX validation (dynasty power-user lens)

*A dynasty commissioner running ~15–20 MFL leagues reviewed this re-review against the UX guardrails and
the actual screens. This section is the felt-experience counterweight to the five engineering dimensions —
what the **user** experiences on a live Sunday, not what's structurally clean.*

**PO bottom line:** **Do not flip `DEVICE_READS_ENABLED` yet** — but the blocker is narrower than the eng
review implies. M-1 (C11 wipe gap) is a hard privacy gate and a one-line fix; ship it regardless. The
single **highest-UX-risk item is M-2 + A-2 together**: an unguarded Shape-A divergence (a real IR/taxi
mis-tag, `mflRead.js:216`) means two screens can show *different rosters for the same league* while an
all-or-nothing fallback (A-2) can flip a whole screen from device to backend mid-scroll — a dynasty
manager **will** notice both, and "the app shows me two different answers" is the most trust-corrosive
thing this shift can do. Flip only after M-1 ships, M-2's `roster_status` bug + parity tests land, and A-2
is partial-tolerant — and flip it **in the offseason at low device%**, never as a Week-1 big-bang.
Everything else (A-1/A-7/A-10) is tunable post-flip and should not hold the gate.

### 4.1 · DON'T DO (engineering-correct, UX-corrosive if done naively)

- **Don't add device-side stagger (A-1) as a flat ~1s-between-calls delay.** The whole point the user
  *feels* is the 11:45am 15-league fan-out getting **faster** by leaving the backend FIFO; naive 1s serial
  spacing across 20 leagues = 20+s to first full paint → device-origin perceived as a **downgrade** at the
  exact moment it should win. **Threatens C1/C9.** Do the limiter as a *concurrency cap* (3–4 in-flight +
  minimal jitter), **not** a per-call sleep.
- **Don't wifi-gate the free-agent pool (A-10) by blocking it on cellular.** "Check waivers from the
  parking lot" is a real dynasty moment (Tuesday-night bye scramble on LTE). Empty/"wifi only" off-network
  reads as **broken** and **violates C5**. Fix the *cost* not the *access*: keep the heavy `freeAgents`
  pool backend-only, or fetch a trimmed top-N on-device — never gate the feature behind a network type.
- **Don't make aggregates partial-tolerant (A-2) in a way that paints a half-empty Home/Portfolio.** A-2
  is right, but "13 of 15 leagues, two just missing" reads like the "why is my league gone" bug.
  Partial-tolerance must pair with a **calm per-league placeholder** ("league 7 — tap to retry", the
  `portfolio.js:358-363` treatment) — never a silently short list. **Threatens C4/C5.**
- **Don't let the cold-start regression (A-7) land on the first-open-of-the-day** (7am "did I lose a
  waiver overnight" trust moment). **Threatens C9/C1.** Don't "solve" it with a device disk cache that
  risks staleness on the read I most need fresh; keep the backend warm so the *fallback* is warm, and let
  instant-paint from the screen snapshot (C1) cover the visual while the cold device fan-out completes.
- **Don't move #11 covered-overlay polling (A-9) so aggressively that it freezes the live board.** Gate
  *background* screens only — **C8 says the visibly-live draft board and Sunday scoreboard never freeze.** A
  frozen live draft grid during a rookie draft is a "did my pick go through" panic, far worse than the
  battery it saves.

### 4.2 · DO DIFFERENTLY (right in spirit, wrong shape)

- **Sequence the flag rollout by latency-forgiveness, not code-readiness.** Flip forgiving screens first
  (Portfolio, exposure/"My Players", pick-inventory, standings, transactions — opened deliberately, mostly
  offseason), unforgiving screens last and behind the limiter + warm-fallback (Home triage, lineups,
  waivers-overview — the Sunday-11:45 / Wednesday-3am hot paths). Watch the beacon fallback rate at each
  step. This is the device-origin analog of "tune the hot path before it's hot."
- **Reshape the ⚡ badge and resolve the glyph collision.** The "live from MFL on-device" ⚡
  (`LeagueScreen.js:71`) **collides with the close-game ⚡** already defined in `help.js:91` — same glyph,
  two meanings, seen in one session — and it appears on the Standings tab but not the Rosters tab two
  functions down, so inconsistent presence reads as a bug. Make "reading directly from MFL" a *quiet,
  uniform* affordance (a small dot or one-time education toast), not a per-tab ⚡. The user doesn't care
  *where* the byte came from; spend the badge budget on **"is this fresh and complete"** (U-1) instead.
- **Make a slow-but-succeeding device read show a calm progress affordance.** Invisible fallback is right
  for *failure* (C4/C5 pass), but a slow 15-league fan-out on weak LTE has no cover: instant-paint shows
  yesterday's snapshot, then 15s of silence. A "refreshing — league 9 of 15" on the pull-to-refresh
  spinner (not a blocking overlay) turns a scary stall into visible progress — additive to C1, not a
  violation.
- **Gate the flag on M-1 and M-2, but NOT on the A-items.** M-1/M-2 are *correctness/trust* gates
  (another account's players; an IR guy mis-tagged active — unshippable). The A-items are *tuning* — ship
  soon, but safe to iterate post-flip at low device% because the backend fallback is always underneath.
  Don't let A-1..A-12 delay a flip that M-1/M-2 have already made safe.
- **Re-rank A-8 (draft "none") up to must-fix-before-flip.** Rated Med/S and buried, but from the chair
  it's a **missed-clock risk**: a newly-joined league one step ahead of the device's cached list *vanishes*
  from the draft overview (`draft.js:370`) and a test *locks that in* (`draft-scheduled-test.js:141-145`).
  During rookie-draft season that's how you autopick a player you didn't want. Felt severity High even at
  S effort; give it the portfolio per-league-fallback treatment before the flip.

### 4.3 · ADD FOR UX (independent product review — what the eng lenses can't see)

- **U-1 · "Complete vs partial" freshness signal on aggregate screens · M.** A tiny "15/15 leagues" (or
  "13/15 · 2 retrying") header turns A-2's per-league fallback from a silent gap into an honest calm state.
  The single most valuable thing to *tell* the user now that fallback is per-league.
- **U-2 · Battery/data budget awareness for a full Sunday session · M · ◑ PARTIAL (highest-leverage slice
  done).** 1–8pm, in and out 40× across 15 leagues, every foreground fan-out is now the user's battery + LTE.
  Much of the cost was already trimmed (A-1 concurrency cap, A-9 no covered-screen polling, A-10 heavy FA
  pool kept backend, `deviceReadCache` 5-min coalescing). **Done now:** the idle prefetch
  (`prefetchOtherTabs`) no longer speculatively warms the heavy **device-fan-out** tab (lineups: rosters ×
  all leagues) **on cellular** — it's marked `device: true` and skipped when a device fan-out would run
  (flag on + creds) AND the link is cellular (`net.js`/`netClassify.js`, best-effort via `expo-network`; a
  lightweight backend prefetch on wifi/unknown is never skipped, and no *user-requested* content is ever
  gated on network type — the PO's rule). Adds a native dep (`expo-network@~6.0.1`) → takes effect on the
  next EAS build. Unit-tested (`netClassify.test.js`). **Deferred (the "M" remainder):** an explicit
  session-wide read/byte budget that lengthens TTLs / suppresses prefetch late in a long session — larger,
  diffuse payoff; the sharp contributors are handled.
- **U-3 · Offline / subway graceful state · S · ✅ FIXED.** Post-shift a read could fail *twice* (device then
  backend), slower to give up. **Fixed:** every on-device fetch is bounded by an 8s timeout
  (`fetchWithTimeout` in `mflDevice.js`) so a dead network fails fast (C4 keeps last data promptly instead of
  spinning); a network failure opens a 15s **offline cooldown** (`deviceHealth.js`) so subsequent reads skip
  the device entirely and go straight to the backend (no doomed device fetch, no SecureStore read); and the
  metrics beacon is suppressed during that window (no POST-storm to a dead backend). A device success clears
  the cooldown immediately. Unit-tested (`deviceHealth.test.js`).
- **U-7 · Expired-cookie path stays a calm re-login, not a silent all-fallback · S · ✅ FIXED (core).** An
  expired *device* MFL cookie used to fall back silently. **Fixed:** a 401/403 device read is now classified
  as a distinct `cookie_expired` reason (observable on `/_metrics`, not lumped into "error"), and it triggers
  a throttled `refreshMflCreds()` — the device re-pulls its cookie from the backend, so if the backend has
  re-authed it catches up instead of failing forever on a stale cookie. If the backend's cookie is *also*
  expired, its own reads fail and the app's existing session-expiry → re-login (C5) flow takes over. Residual
  (backend-side, larger): proactively turning an expired-MFL-cookie *backend* read into the re-login prompt
  even when the app session token is still valid — a pre-existing gap device-origin doesn't create.
- **U-4 · "Working while the backend is down" — the device-origin reliability win · M · ✅ FIXED (core).** A
  backend 502 at 11:50am used to kill the Shape-A reads because each still calls the backend for its
  enrichment (franchise directory + player lookup + exposure enrich) — the *only* backend dependency left
  once the rosters come straight from MFL. **Fixed:** those enrichment calls now route through
  `deviceEnrichCache.js` — a cache-through that always tries the backend, remembers the last success, and on
  a backend **failure serves the last-known value** tagged `_stale`. So rosters / standings / transactions /
  exposure now assemble entirely from the device's own MFL reads + cached enrichment when the backend is
  unreachable — **true backend-independent reads** — and the result carries an `_offline` flag a screen can
  surface. In-memory (covers the warm mid-Sunday outage — the actual scenario) and wiped on logout/auth-loss
  (C11 — the exposure enrich carries personal tag/watched). Unit-tested (`deviceEnrichCache.test.js`).
  Residual (documented follow-up): **persist** the cache so a *cold launch during* an outage also works, and
  render the `_offline` flag as a calm "last-known" note.
- **U-5 · Faster-than-backend reads as an explicit, measured promise · S · ✅ FIXED.** `preferDevice` already
  beaconed per-read device-vs-backend latency, but you had to eyeball it across read types. **Fixed:**
  `/_metrics mfl.deviceLatency` now rolls it into one answer — pooled `deviceAvgMs` vs `backendAvgMs`,
  sample counts, and **`deviceFasterByMs` / `deviceFasterPct`** (positive = device wins). That's the single
  number that decides whether "reads load faster on your own network" is a headline benefit or whether the
  flip is purely a scaling play — and it sequences the rollout (forgiving screens first only *pays* if
  device actually wins there). Tested (`player-lookup-test.js`).
- **U-6 · Parity self-check the user never sees · M.** Ties to A-6: add the sampled shadow-compare with a
  product acceptance bar — **zero tolerance for divergence on roster membership + player status** (what the
  user acts on), looser on cosmetic fields (`format`/`name`, M-2's latent drops).
- **U-7 · Expired-cookie path stays a calm C5 re-login, not a silent all-fallback · S.** An expired
  *device* cookie makes every read throw `no_creds` and silently fall back for hours — functionally fine,
  but it quietly abandons the feature and doubles latency without telling the user. Surface the *same*
  single "tap to re-login" the backend session-expiry does.

**PO one-line summary:** the shift is a real scaling and reliability win, but it trades the backend's
*single source of truth* for two paths that can disagree — flip it only once they provably can't (M-1/M-2),
sequence forgiving-screens-first, and spend the new UI budget telling the user **"complete and fresh"**,
not **"device vs backend."**

---

*Generated by five independent read-only review agents + a dynasty product-owner UX pass on 2026-07-26. No
application code was modified to produce this review. Pull M-1/M-2, A-8, and the UX items (U-1…U-7) into a
task list before flipping `DEVICE_READS_ENABLED`; update this file's status as items close.*
