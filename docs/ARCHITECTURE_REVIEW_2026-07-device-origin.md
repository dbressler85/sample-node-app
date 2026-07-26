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

- **M-1 · C11 privacy gap — `deviceReadCache` is not wired into logout / auth-lost wipe · High · S.**
  Both wipe paths (`App.js:180-188` auth-lost, `:208-217` logout) clear disk, `homeCache`, the mem store,
  and SecureStore — but **not** `deviceReadCache`, which only clears on *writes* (`mflDevice.js:17`). In a
  single process, a second account logging in before restart can get a **cache hit on the first account's
  parsed rosters** (up to the 5-min TTL, `deviceReadCache.js:19-29`). `UX_GUARDRAILS.md:111` C11 explicitly
  forbids adding a store without wiring the wipe. One-line fix: `deviceReadCache.clear()` in both paths.
- **M-2 · Shape-A divergence, unguarded — and one case is a live bug · High · M.** The four "device
  assembles" surfaces build the final object on-device while the backend fallback builds a *different* one
  via separate services. Present-today divergences:
  - `assembleTeams`/`Standings`/`Transactions` drop top-level fields the backend returns
    (`format`, `name`, `leagueId` — `mflRead.js:284,322,374` vs `league.js:175,102-108,224`). *Latent* —
    UI-masked today because `LeagueScreen` sources `leagueId` from nav and renders neither.
  - **`shapeRoster` reads only `status`, not `status || roster_status`** (`mflRead.js:216` vs
    `league.js:152`). If MFL emits `roster_status`, an IR/taxi player mis-tags as `active` on the device
    Rosters tab but is correct on fallback — **a live silent bug.**
  - **Zero parity tests cover any Shape-A surface** (all Shape-B surfaces have cold-cookie parity tests).
  - Fix: converge the backend fallback onto the shared `mflRead.assemble*` (or mirror the fields), fix the
    `roster_status` read, and add device-vs-backend output parity tests for all four Shape-A surfaces.

### Before you flip the flag (high-value, corroborated across all five agents)

- **A-1 · Device omits the request discipline it was specified to mirror · Med · S.** The device fires
  `Promise.all` across 15–20 leagues with **no stagger, no concurrency cap, no 429 backoff** — only
  no-retry is ported (`mflRead.js:197-205`). `pickInventory` = 3 reads × 20 leagues ≈ 45–60 simultaneous
  MFL requests (`mflDevice.js:255-265`). Directly contradicts `DEVICE_ORIGIN_MFL.md:83-87`. Can't ban
  *other* users (own IP), but it self-429s exactly on the big accounts device-origin is meant to help.
  Fix: an on-device limiter (3–4 in-flight + minimal stagger) — trade a little first-paint latency for
  politeness parity with the backend.
- **A-2 · All-or-nothing aggregates re-concentrate load under stress (~2N amplification) · Med · M.** One
  league's 429 rejects the whole device `Promise.all`, discards up to 60 *successful* device reads, and
  re-runs the full N-league fan-out on the backend FIFO (`mflDevice.js:71-91`). On a Sunday MFL
  rate-limit, many devices fall back at once — handing the backend the very herd device-origin was meant
  to offload, *plus* the wasted device attempts. Fix: **partial-tolerant aggregates** — fall back only the
  leagues that failed.
- **A-3 · One registered UA bursting from hundreds of uncoordinated IPs · Med · S.** `DynastyCentral/1.0`
  is hardcoded (`mflDevice.js:44`) rather than sourced from the registered `config.userAgent`. MFL sees
  one client identity bursting from every device on Sunday — a global client-reputation risk the single-IP
  model structurally prevented.
- **A-4 · Beacon has an unbounded client-supplied map key · Low · S.** `recordDeviceRead` keys on the
  client `read` string with no allowlist/cap (`metrics.js:55-70`); authed, so not open abuse, but a
  memory-growth vector into a process-global map. Allowlist the known read names.
- **A-5 · Backend cross-user cache erosion · Low · —.** Device data bypasses `exportRequest`
  (`portfolio.js:358`), so shared-cache hit rate falls and fallbacks trend cold. No correctness bug
  (invalidation intact both sides); a hit-rate/latency regression that makes A-2's fallback colder.
- **A-6 · The beacon cannot see *silent* divergence · Med · M.** It records failures/latency, not "both
  paths returned different data" (`metrics.js:55-70`). M-2's divergence would ship invisibly at 95%
  device%. Consider a sampled shadow-compare and a device-parser-version header (also guards Shape-A
  version skew from stale app builds — N4).
- **A-7 · Cold-start latency regression · Med · —.** `deviceReadCache` is session-only
  (`deviceReadCache.js:31`), so every cold launch re-fans-out with no server-warm entry to lean on
  (freshness-neutral, latency cost). Reverses the prior review's central mitigation (warm loop + shared
  cache).
- **A-8 · Draft's missing-league branch silently returns `none` · Med · S.** `draft.getOverview` refuses
  a backend read for a league absent from the device map (`draft.js:370`), so a newly-joined league one
  step ahead of the device's cached list **vanishes** from the draft overview — the owner could miss a
  clock. A test currently *locks in* this behavior (`draft-scheduled-test.js:141-145`). Give it the
  portfolio treatment (marked placeholder / per-league fallback, `portfolio.js:358-363`).
- **A-9 · #11 (covered-overlay polling) upgrades in urgency · Med · M.** A covered screen that keeps
  polling now spends the user's own IP/battery/cellular and risks a self-429, where before it was a cheap
  backend hit. Its prior slot should move earlier. Guardrail unchanged: gate background screens only,
  never freeze the visibly-live draft board/scoreboard (C8).
- **A-10 · Heavy `freeAgents` pool fetched on-device, no wifi-gate · Low · S.** best-available / waivers
  overview download the full free-agent pool (thousands/league) for every league on cellular
  (`mflDevice.js:219-243`). Consider wifi-gating the heavy pools or keeping `freeAgents` backend-only.
- **A-11 · Backend now trusts device-supplied export content · Low · —.** POST routes pass `deviceReads`/
  `deviceRosters` through with no shape validation (`routes/draft.js:25-26`); self-scoped (a user can only
  feed bad data into their own read-only view), so low risk — but the backend read layer is no longer the
  sole authority on MFL data shapes.
- **A-12 · Testability gap on the device path · Low · S.** `deviceReadCache` has a unit test and the
  `mflRead` sync is CI-drift-guarded, but there is **no test for `mflDevice.js`** — `preferDevice`
  fallback selection, `_source` tagging, `fallbackReason` bucketing — the riskiest new logic is
  build-verified only.

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

*Generated by five independent read-only review agents on 2026-07-26. No application code was modified to
produce this review. Pull M-1/M-2 and the A-items into a task list before flipping `DEVICE_READS_ENABLED`;
update this file's status as items close.*
