# Architecture & Quality Review — July 2026

Second third-party review of Dynasty Central — Expo/React Native mobile app + Node/Express
MFL-aggregation backend, ~27k LOC, no TypeScript. Read-only; no code was changed to produce it.
Companion to and successor of [`ARCHITECTURE_REVIEW.md`](ARCHITECTURE_REVIEW.md) (the prior
review + Phase 0→3 roadmap), [`UX_GUARDRAILS.md`](UX_GUARDRAILS.md), and [`LESSONS.md`](LESSONS.md).

**Method:** five parallel read-only deep-dives by independent reviewers —
backend architecture, backend performance & scaling, backend tech-debt & code-quality,
security & best-practices (full stack), and mobile architecture/quality/UX-guardrail
compliance. Each cited `file:line`, cross-checked the prior review to separate
resolved / still-open / newly-introduced debt, and prioritized findings. Overlapping
findings across reviewers have been reconciled below (e.g. the shared-cache tenancy
question, which one reviewer flagged and another verified already-enforced).

**Bottom line:** the app has advanced materially since the last review and is in genuinely
good shape. **No P0 was found in any dimension** — no crash, no blank-screen, no
guardrail violation, no auth bypass, no committed secret, no quota/ban risk. The entire
Phase 0 roadmap is shipped, two of the four Phase-2 "structural bets" (MFL repository layer,
client↔server contract) are done, and the one bug class the project fears most — the
uncatchable root-component `ReferenceError` — is now **tool-enforced** by `no-undef` + a CI
gate that has already caught two latent crashes. Three well-built new systems arrived since
the last snapshot: a **cross-user shared cache**, **dual priority lanes + adaptive backoff**,
and a **Sunday warm loop**, all made legible by `/_metrics`.

The remaining debt is the debt the last review predicted would be *deferred*, plus a handful
of concrete new items. The headline theme: **the design caps MFL quota risk by construction,
so the real Sunday-morning exposure is latency, and the biggest latency leak is a global feed
(`injuries`) that isn't shared or warmed.** The largest maintainability taxes are unchanged:
`demoMode` smeared through the service layer with no data-source seam, ~40 error-swallows that
drop MFL's detail, and the hand-rolled mobile navigation + dual cache systems.

Legend — priority: **P0** ship-blocker (none found) · **P1** schedule it · **P2** polish /
defense-in-depth. Effort: **S** ~hours · **M** ~days · **L** ~week+.

---

## Product/UX validation (dynasty power-user lens)

A dynasty-FF product owner (commissioner running ~15 MFL leagues) reviewed this roadmap against
the UX guardrails and the actual app. The verdict reframes the priorities:

**This is a hygiene-and-hardening roadmap, not a value roadmap.** Almost nothing on it adds
something a user can point to — which is fine (the app is feature-mature through M4), but it means
the only items that jump the queue are the ones a user *feels*, and they all cluster on one axis:
**Sunday-morning speed and reliability** (the 11:45am lineup scramble across N leagues is fantasy's
most emotionally charged moment). Product-adjusted sequencing:

- **Ship now, before the season (felt Sunday speed/trust):** #1 injuries share+warm *(the whole
  ballgame — on every roster/lineup build)*, #2 parallelize `extraItems`, #6 async persist, #8
  error-swallow telemetry *(reframed: server-side honesty powering "3 leagues rate-limited" — NOT
  new red banners)*, and #5 Portfolio `getItemLayout` *(offseason screen, and it's offseason now)*.
  The hot path must be tuned before Week 1 — you can't safely tune it once it's hot.
- **Gate to their proper window, don't do now:** #10 warm budgeting & #12 per-account throttle
  *(multi-user only — latent for a solo/hobbyist crowd)*; #13 nav + dual-cache refactor
  *(highest UX-regression surface in the doc — do it **only** if C1–C4/C6/C10 are encoded as tests
  first and it ships in the offseason window, else defer to next summer; never mid-season)*.
- **Opportunistic, never a headline:** #9 `demoMode` seam *(biggest tax, lowest user signal — do it
  when it unblocks live-MFL work)*, #14 fat-screen splits, #7 metrics-token, and the P2 cluster.

**Protect these while doing the work:** #11 covered-overlay polling must **never** freeze the
*visibly-live* draft board or scoreboard (gate background screens only — a frozen live board reads
as a broken app); #3 draft-clock deletion is safe but sits next to the slow-draft clock powering
On Deck + the on-the-clock push — confirm `autoClock` is untouched; #4 rate-limiter ceiling must be
**generous** (a 15–20 league fan-out is normal power-user behavior, not abuse).

### User-value gaps the engineering review couldn't see (build these)

The reviews mirror the code; they can't say what the app *doesn't do*. The PO checked what already
exists (contender/rebuild outlook ✓, My Draft List autopick queue ✓, Rookies filter ✓, On Deck
aggregation ✓, push for on-the-clock/trade/lineup/watchlist ✓) and found these real holes — and it's
**rookie-draft & slow-draft season right now**, which the roadmap has nothing for:

1. **Waiver/FAAB *result* push + budget-remaining lens (M) — highest-value missing feature.** The app
   speaks *going into* waivers (bid guidance, lost-bid reconciliation in-app) but push **never fires
   for waiver results** — the 3am-Wednesday "won Wright $34 / lost to $41" moment across 15 leagues.
   In-season-critical.
2. **Slow/email-draft pick-clock reminders (S–M) — on-calendar now.** Push fires *once* when you go on
   the clock, but slow drafts run 4–24h clocks over weeks; add an escalating "2h left in [league]"
   nudge before an unwanted autopick. The queue exists; the nudge to maintain it doesn't.
3. **Pre-kickoff final-inactive sweep (M).** Close the loop between the injuries feed (which #1 makes
   fast/shared) and lineups already set: "a player you're *starting* in 3 leagues was just ruled OUT
   — tap to fix" at 11:55am.
4. **Cross-league rookie big board (M) — the offseason "Set All Lineups."** One ranked/tiered rookie
   board that syncs into every league's autopick list at once (respecting per-roster need), instead
   of re-ranking per league.

*Nice-to-have, don't preempt the above:* turn the contender/rebuild label into per-league buy/sell
target suggestions; a shareable/multi-year trade-fairness view for league-mate trust.

**PO bottom line:** ship #1/#2/#5/#6/#8 now, gate #10/#12/#13 to their windows, let the rest ride
opportunistically — and the one *user-facing* thing to add before the debt work is **waiver/FAAB
result push + budget lens** (with slow-draft clock reminders as its in-flight companion). The app
already speaks going *into* waivers and drafts; it goes silent at the exact moments a dynasty
manager's heart rate spikes.

---

## Resolved since the last review (the wins)

Verified fixed by the reviewers, with the prior review's IDs where applicable:

- **Login `ReferenceError` (`mfl.js:289`, prior "do this week" #1 / S-3)** — now uses `hint`,
  returns 401, and deliberately withholds MFL's upstream body from the client.
- **SSRF (S-1)** — `MFL_HOST_RE` allowlist enforced in every URL builder *and* re-validated on
  every redirect hop via `redirect:'manual'` (`mfl.js:161–212`).
- **No lint / no CI (the process gap)** — ESLint `no-undef:error` + `backend-ci.yml` running
  lint + `smoke:all` on both packages on every PR; mobile lint runs clean.
- **Bounded `readCache`**, **sorted cache keys**, **globbed test registry**, **demo-in-prod boot
  guard** (`server.js:12–15`) + `render.yaml` pinning `MFL_DEMO_MODE=false`, **daily player-DB TTL**.
- **Trade-math duplication (C6 / bet #3)** — single-sourced via codegen + a CI drift test; the
  mobile copy is `@generated` and imported, computed on-device with `useMemo`.
- **MFL repository layer (bet #4)** and **fail-soft zod at the boundary (bet #4)** — both shipped
  (`lib/mflRepo.js`, `lib/apiSchema.js`).
- **Mobile crash class** — `no-undef` tool-enforced; **all entrance animations default to settled**
  (`Reveal.js:11`, `App.js:96–104`); **C7 scroll-drop** designed out by keep-alive overlay-on-tabs;
  **Portfolio virtualized**; **PlayersScreen derived work memoized**.
- **Security core** — password never persisted/logged (shape-only login log), AES-256-GCM session
  encryption keyed by `scryptSync(SESSION_SECRET)` failing closed, `SESSION_SECRET`-unset ⇒
  in-memory-only (cookie never hits disk in plaintext), 192-bit tokens, logout wipe, per-IP login
  lockout, `/_metrics` token-gated + 404 in prod when unset. **No committed secrets.**

---

## Priority roadmap (consolidated & deduped)

### Quick wins — small, high-value, do first

| # | Item | Where | Effort | From |
|---|------|-------|--------|------|
| 1 | **Share + warm the `injuries` feed** — it's a global NFL feed but keyed per-user at 5-min TTL and never warmed, so every user re-fetches it every 5 min on the Sunday hot path (every roster & lineup build calls it). Add `'injuries'` to `LEAGUE_GLOBAL_TYPES` and to `warmLeague`'s global-priming. | `mfl.js:335–340`, `nfl.js:158`, `warm.js:30–41` | S | Perf |
| 2 | **Parallelize `portfolio.extraItems`** — three sequential MFL awaits (`pendingTrades`→`pendingWaivers`→`nextWaiverRun`) on the per-league Home path; `Promise.all` them (~3× triage latency). | `portfolio.js:145,149,157` | S | Perf |
| 3 | **Delete the vestigial manual draft-clock override** — superseded by auto-detect from the `league` export; **no caller** (0 mobile refs), **no test**, orphaned POST route, `draftClocks.all` is a dead export, and a stale comment now contradicts reality. Remove the store, `setDraftClock`, the route, and the `manualClock` branch (keep `autoClock` + a sane default). | `store/draftClocks.js`, `services/draft.js:366–367,652–656`, `routes/draft.js:67–76` | S | Arch + Tech-debt |
| 4 | **Add `helmet` + a general rate limiter** — the only Express deps are cors/express/morgan/zod; no security headers, and every authenticated MFL-proxying route is unthrottled (per-IP guard covers only `/login`). | `app.js:22–31` | S | Security |
| 5 | **Portfolio `FlatList` `getItemLayout`** — UX_GUARDRAILS §2 requires an estimated row height so a fast fling never flashes blank cells; rows are near-fixed height. | `PortfolioScreen.js:137–146` | S | Mobile |
| 6 | **Make `persist.flush` async / per-namespace** — `fs.writeFileSync` + full-root `JSON.stringify` on the event loop, amplified by the 45s notifications tick calling `persist.touch()` per device; stalls the loop for concurrent Sunday requests during the write. | `persist.js:34–46`, `notifications.js:207` | S | Perf + Arch |
| 7 | **Move the `/_metrics` token out of the query string** — `req.query.token` lands in `morgan` request-URL logs; accept it via the `x-metrics-token` header only (already supported). | `routes/metrics.js:21`, `app.js:31` | S | Security |

### P1 — schedule these

| # | Item | Where | Effort | From |
|---|------|-------|--------|------|
| 8 | **Instrument the ~40 read-side error swallows** — `catch (e) { return [] \| {} \| null }` blocks log nothing, so an expired cookie or 429 reads as "no data" instead of "re-login / rate-limited" — a direct LESSONS violation. Add a shared `safe(promise, fallback, ctx)` that logs `mfl.errorDetail(e)` uniformly, and let genuinely-degradable sections mark themselves partial so the UI can say "some leagues failed." | `picks.js:107–169`, `trades.js:264–331`, `playerhub.js:299–485`, `scoreboard.js:99`, `league.js:40`, +~30 more | M | Arch + Tech-debt |
| 9 | **Give `demoMode` a data-source seam** — it branches through ~18 services (145 refs); the repository layer was the natural home but stayed live-only, so every service re-implements `demoMode ? demo.x() : repo.x()`. Make `mflRepo` (or a per-request provider) own the split so services call one method. Biggest single maintainability tax. | `mflRepo.js:18–20`, `services/*` | L | Arch |
| 10 | **Budget / round-robin the warm pass** — work ≈ Σ(users × leagues); at scale a pass can't finish within `warmIntervalMs`, the `running` guard skips the next tick, and leagues iterated last never warm before kickoff. Cap leagues/pass and round-robin across ticks; surface "pass truncated" in `lastRun`. | `warm.js:48–80` | M | Perf |
| 11 | **Gate polling for covered overlays + share one backdrop** — covered screens keep polling (`DraftScreen` 15s, `OnDeckScreen` 60s unconditional, a covered `Scores` tab stays `active`) and each overlay layer mounts its own full-screen `FieldBackdrop` SVG. Thread a "top-of-stack" flag into `usePoll` active args; render a single shared backdrop behind the stack. | `App.js:461–468`, `DraftScreen.js:166`, `OnDeckScreen.js:66`, `ScoresScreen.js:34` | M | Mobile |
| 12 | **Per-account throttle + penalty state (prior S-2)** — `active`/`penaltyUntil`/both waiter lanes are process-global, so one account's 429 throttles everyone (and the warm loop). Key per host/account with a generous single-account ceiling **before** going multi-user. Quota stays safe regardless; this is latency isolation. | `mfl.js:29–59` | M | Arch + Perf + Security |
| 13 | **Hand-rolled nav + dual cache systems** — `App.js` models nav as `tab` string + index-keyed `overlayStack` with ~30 drilled `onOpenX` callbacks, and `HomeScreen` hand-rolls a module-level `homeCache` parallel to `resourceStore`. The keep-alive model fixed the UX symptoms, lowering urgency, but the maintainability tax + "same key through two layers" hazard remain. Now safe to migrate (react-navigation + one store) behind the existing test net. | `App.js:219–468`, `HomeScreen.js:63–184` | L | Mobile |
| 14 | **Split the fat screens/services** — `TradesScreen` 1062 lines/23 `useState`, `WaiversScreen` 813, `PlayersScreen` 779; `services/trades.js` ~1090, `services/draft.js` 658 with `getLeague`/`getDraftList` repeating the same context-load scaffold. Extract per-screen hooks / `loadDraftContext` / pure `lib/` helpers. | (as listed) | M | Tech-debt + Mobile |

### P2 — polish & defense-in-depth

- **Document persistence's single-process constraint** at the module head; it's whole-file
  last-writer-wins (`persist.js`). Swap to SQLite/Redis only if scale demands — don't pre-build.
- **Key app-local data on MFL's authoritative `MFL_USER_ID`, not the typed username (S-4)** —
  `acct:<lowercased-username>` lets two demo clients on the same username share tags/watchlist/push,
  and case/email variants orphan live data. The id is already extracted at `mfl.js:473–477`.
- **Validate request bodies at write routes** — the zod layer is response-only + fail-soft; add
  `checkRequest` zod schemas on POST/DELETE routes (100 KB `express.json` cap bounds size today).
- **Migrate remaining inline envelope-unwraps into `mflRepo`** (~13 sites: `myDraftList`,
  `futureDraftPicks`, `rules`, `adp`, `injuries`, `nflSchedule`, `topOwns/topAdds`).
- **Extract a `mapLeagues(leagues, fn, fallback)` helper** — the `Promise.all(leagues.map(async…{try…catch}))`
  fan-out is copy-pasted ~20× (re-implements concurrency + isolation + the swallow above each time).
- **`pad4(id)` helper** — the `String(id).padStart(4,'0')` hard-won rule is open-coded at 8 sites.
- **Break the lazy-`require()` service cycles** — 5+ in-function requires hide real cyclic coupling
  (portfolio↔waivers/trades, waivers↔draft, playerhub↔draft); extract shared leaves into `lib/`.
- **Name the trade sweetener/counter magic numbers** (`0.9`/`1.1` at `trades.js:664,1052,1055`) or
  source them from `tradeMath.TAG_MOD` so they can't drift.
- **`memo` `max` is expired-only prune, not LRU** — `rosterMemo`/`faMemo` grow to the working set
  during the Sunday window (TTL-bounded, not a leak). True LRU or document the bound.
- **Push scheduler is O(devices × sessions)/tick + sequential per device** — index sessions by
  account (Map) for O(1) lookup; consider bounding devices-per-tick (`notifications.js:184–216`).
- **Share `futureDraftPicks` (whole-league) + `playerProfile`** — both member/global-invariant but
  per-cookie at 5-min today; candidates for `LEAGUE_GLOBAL_TYPES`.
- **Extend `warmEndHourEt` past 2pm** if 4pm/SNF-slate latency matters (`config.js:155`).
- **Mobile:** `React.memo(PlayerRow)` + `useMemo` the `extraData` object + stable `onPress`
  (`PlayersScreen.js:471,294,296`); key overlays by a monotonic id not array index (`App.js:461`);
  fix 5 `no-unused-expressions` warnings (silent side-effect no-op risk); add a `jest-expo`
  mount-each-screen render smoke test; DRY the per-screen loading/error/empty triad into one
  `<Async>` wrapper (makes the C4 gate structural, not per-screen discipline).
- **Mobile hardening (S-6 residual):** set `android.usesCleartextTraffic:false` and allowlist
  `https?:` before `Linking.openURL` for news links.
- **Consider a supervised restart** for `uncaughtException` rather than swallowing (`server.js:22–27`).
- **Keep bumping backend dep floors** — lockfiles present, `npm ci` in CI, no exposed vulnerable dep
  found; the floors just want to stay ahead of CVEs.

---

## Sunday-load risk assessment (the owner's central worry)

- **Quota / ban risk: LOW, by construction.** The process-global throttle caps outbound at
  ~6.6 MFL req/s regardless of user count (4 concurrent × 150 ms stagger), and the adaptive backoff
  pulls further back on the first 429. A thundering herd becomes a *queue*, not a ban. **This is the
  system's strongest property — preserve it** (and note it's the reason per-account throttling,
  #12, is a latency change, not a safety one).
- **Latency under cold load: the real exposure.** The same global queue serializes a cold
  Sunday-morning surge behind one FIFO; drain grows with (concurrent users × cold leagues). The
  intended mitigations — warm loop + shared cache — have two holes: (a) cross-user sharing only
  helps users who overlap in the same MFL league or read *global* feeds, so for a hobbyist crowd
  with disjoint leagues the value lands almost entirely on the global feeds (players, schedule,
  ADP, ownership — **and `injuries`, which is the one global feed not shared** → quick-win #1); and
  (b) the warm pass can't finish at scale (#10).
- **Cache freshness vs the 6AM→1PM window: correctly tuned.** Rosters/FA/schedule 5-min,
  projections 30-min, re-warm every 5-min ⇒ nothing served is >1 cycle stale through kickoff; FAAB's
  60s `maxAge` carve-out is the right pattern. The lone mistuned spot is `injuries` (per-user, unwarmed).
- **What to watch on a real Sunday:** `/_metrics` `throttle.queuedNormal`, `callsPerMin`, and
  `warm.lastRun.fetched` — a growing queue or a high `fetched` is the early signal to act on #1/#10.

---

## Per-dimension summaries

**Backend architecture** — Phase 0 cleared; MFL request layer, shared cache, priority lanes, warm
loop, `mflRepo`, and boundary zod are all well-built. Open: `demoMode` seam (#9), error-swallows
(#8), global throttle (#12), single-process persistence (P2), lazy-require service mesh (P2).
The shared-cache tenancy invariant it flagged is **verified enforced today** by `findLeague` (see
security) — the action is to *keep* it structural (document the invariant; ensure future
league-scoped reads route through `findLeague`).

**Backend performance & scaling** — quota-safe by design; latency is the exposure. Top fixes:
`injuries` share+warm (#1), `extraItems` parallelize (#2), warm-pass budgeting (#10), async persist
(#6). Serial waves the prior review flagged are already fixed.

**Backend tech-debt & code-quality** — zero P0 bugs; franchise-id padding correct on every path;
new-feature tests (draft-clock, warm, metrics, trophies, playoffs) are substantive. Vestigial
draft-clock override is the one clear deletion (#3); error-swallows (#8) and the copy-pasted
fan-out (`mapLeagues`, P2) are the breadth items.

**Security & best-practices** — overall risk **LOW**; every prior P0/P1 security item verified
fixed; no committed secrets; credential contract holds end-to-end; tenant isolation
**double-enforced** via `findLeague` (404s non-members before any shared read). Remaining are
hardening: helmet + rate-limit (#4), `MFL_USER_ID` keying (S-4, P2), metrics-token-in-query (#7),
request-body validation (P2).

**Mobile architecture / quality / UX-guardrails** — no P0; the feared crash class is tool-enforced;
**all 11 UX contracts pass** except a residual fast-fling blank-cell risk on Portfolio (#5). Debt is
structural: hand-rolled nav + dual caches (#13), fat screens (#14), covered-overlay polling (#11),
and bounded polish (P2).

---

*Generated by five independent read-only review agents on 2026-07-25. No code was modified.
Pull the roadmap items into a task list before starting a batch; update
[`ARCHITECTURE_REVIEW.md`](ARCHITECTURE_REVIEW.md)'s status as items close.*
