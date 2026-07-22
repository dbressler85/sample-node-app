# UX Guardrails

Product-owner guardrails for the architecture & security roadmap (both architect passes).
These protect the experience while the codebase is refactored. **They are product
requirements, not implementation details** — the code underneath may change freely; the
behaviors below may not regress without an explicit product decision.

Audience: anyone opening a PR that touches **navigation, the cache/data layer, list
rendering, animations, or error surfaces**. If your change touches one of those, it must
satisfy the Protected Contracts and pass the pre-merge checklist at the bottom.

Context: users manage ~15 dynasty leagues from one hub and act during time-sensitive
windows (waivers, trade deadline, draft day, gameday). Speed, not losing state, and a
"feels alive" polish are the product's core promises. Several of these contracts were paid
for in bug-fix cycles — don't give the ground back.

---

## 1. Protected UX contracts — must survive any refactor

Each is a behavior + how to prove it still holds + where it lives today.

### C1 — Instant paint on return; no blank flash
Returning to a tab (or reopening one) shows its last content **synchronously**, never a
spinner or empty frame first.
- *Verify:* Home → Players → open a player → back. Players is fully rendered on the first
  frame, no skeleton.
- *Today:* in-memory snapshot seeds `useState` in `useCachedResource` (`mem` map) and
  `HomeScreen`'s module-level `homeCache`.

### C2 — No network reload on read-only navigation (throttle)
Navigating away and back **without acting** does not refetch within the stale window
(currently 45s). This is the fix for "it reloads everything every time I go back."
- *Verify:* open Trades inbox, back, reopen within 45s → no new network call (check the
  request log); content is unchanged.
- *Today:* `mem`/`homeCache` carry an `at` timestamp; reload only fires when
  `now - at > staleMs`.
- **Do not** raise the throttle window to "save requests" (staler data) or drop it to 0
  ("always fresh" = the reload bug returns). 45s is a product-tuned value.

### C3 — Immediate reflection after a write
Any mutation (set lineup, submit/cancel claim, accept/reject/propose trade, add/drop,
star) makes the next view of an affected screen show the new state — the throttle must
**not** hide a change the user just made.
- *Verify:* set a lineup in the editor → back to Lineups tab → the change is visible
  immediately, not after 45s.
- *Today:* the api layer fires `invalidateCaches()` after any successful non-GET; every
  screen snapshot subscribes and marks itself stale.
- **Do not** ship a data-layer change that keeps the throttle but loses the
  invalidate-on-write hook. C2 and C3 are a pair; breaking either breaks the feel.

### C4 — Never blank a populated screen on a failed refresh
A background refetch that fails keeps the last-known data on screen. A transient 502 on
re-entry must not wipe a screen that was already showing content.
- *Verify:* force a backend error, return to a populated tab → data stays, no error takeover.
- *Today:* hook/error paths set `error` without nulling `data`; error UIs are gated on
  `!data`.

### C5 — Quiet degradation; loud only when it helps
One dead league (or a flaky MFL read) degrades **silently** — the rest of the screen still
renders solid. The **only** failure surfaced loudly is session/cookie expiry, which gets a
clear "tap to re-login." No scary red banners for partial data.
- *Verify:* one league's read fails → its tile is absent/subtle, no app-wide error;
  an expired session → a single clear re-login prompt.
- **Do not** implement "surface swallowed errors" as more visible error banners. Route
  swallows to server-side telemetry; keep the user-facing surface calm.

### C6 — Instant local trade preview
The trade builder recomputes its value/verdict **on-device** as the user toggles each
asset — no network round-trip per checkbox.
- *Verify:* toggling assets/FAAB updates "you get / send / verdict" with zero latency.
- *Today:* `TradesScreen` computes `analyze()`/construction locally (mirrors the backend).
- **When** the client/server trade math is de-duplicated into a shared module, the pure
  function **stays on-device** (imported from shared). Sharing the *source of truth* is the
  goal; moving *computation* to the server is a regression.

### C7 — Scroll & in-progress state survive navigation
Opening a detail screen and returning preserves scroll position and any half-built state
(a trade being assembled, a filter/sort selection). *This is partially broken today* (the
overlay-unmount drops FlatList scroll) — the navigation migration must **fix** this, and
absolutely must not make it worse.
- *Verify:* scroll deep into rankings → open a player → back → same scroll offset. Build a
  trade halfway → glance at a partner's profile → back → the in-progress offer is intact.

### C8 — The app feels alive
Entrance reveals, press-scale, count-up numbers, and ambient motion stay. Animations are
native-driven and the first screenful animates on load.
- *Verify:* lists still stagger-in; tiles/buttons still dip on press; totals still count up.
- **Do not** remove animations to hit a perf number. Capping entrance animation to the
  first ~12 (off-screen) rows is fine and expected; disabling it is not. Keep the
  `AnimatedNumber` count-up on Home/Portfolio.

### C9 — Fast, clean cold start
The app paints quickly on launch, and the branded lockup does not visibly "pop" from a
system font to Oswald on the hero.
- **If** the display-font `await` is removed for speed: gate it so a restored session paints
  immediately, and eliminate the swap (bake the font into the native splash, or hold the
  branded splash one beat on first launch). A faster paint that introduces a FOUT flash on
  every cold start is not an unqualified win — it's a product trade to make deliberately.

### C10 — Domain correctness that shipped recently
Free-vs-**draftable** labeling (a player isn't a free agent until the league's draft is
held) and **FAAB** ("$20 FAAB", not "Player BB_20") render correctly everywhere. Any
data-layer or contract change must keep these intact.
- *Verify:* the watchlist/profile show "draftable" in un-drafted leagues; an inbox offer
  containing `BB_20` shows "$20 FAAB".

### C11 — Logout wipes everything (privacy contract)
Logout / session-loss clears the keychain token **and** every cache layer (disk +
in-memory `mem` + `homeCache`), so the next account never sees the previous one's data.
- **Do not** add a new cache/store without wiring it into the logout + auth-lost paths.

---

## 2. Per-change do / don't — the risky items

Only the changes with UX exposure are listed. Everything not here (security hardening,
CI/lint/tests, backend parallelization, memoization, MFL repo layer, doc-only items) is
UX-neutral or UX-positive — ship freely, respecting the contracts above.

### react-query (or any new data store) — 🔴 highest UX risk
- **DO** configure it to replicate C1–C4 exactly: seed from cache for instant paint,
  `staleTime = 45s`, refetch-on-mount **only when stale**, invalidate-on-write, and keep
  data on error.
- **DO** turn off aggressive defaults (`refetchOnWindowFocus`, refetch-on-every-mount) that
  would reintroduce the reload bug (C2).
- **DON'T** land it without C1/C2/C3/C4 encoded as tests first (see §3).

### Navigation migration (react-navigation) — 🔴 large regression surface
- **DO** treat scroll preservation (C7) as an acceptance criterion — it's the main UX prize.
- **DO** re-verify every deep-link/seed path (open trade desk with a seeded player, counter
  an offer, "shop" a player, waiver deep-links) and the ErrorBoundary/celebration host still
  wrap the tree.
- **DON'T** do it before the test net exists, and **don't** ship it mid-season (§3).

### Portfolio virtualization — 🟡
- **DO** give the FlatList estimated row heights (`getItemLayout`/`estimatedItemSize`) so
  fast scrolling never shows blank cells.
- **DO** keep the entrance animation on the first screenful (C8).
- **DON'T** convert to FlatList and leave rows unmeasured (blank-cell flicker) or strip the
  `Reveal`.

### Error-handling standardization — 🟡
- **DO** add telemetry to the ~40 silent swallows (server-side logging).
- **DO** surface session expiry clearly (C5).
- **DON'T** turn partial-data degradation into user-facing error banners.

### Shared trade-math package — 🟡
- **DO** extract the pure functions + thresholds to a shared module and import on both sides.
- **DON'T** "fix the duplication" by having the client fetch the verdict from the server —
  that breaks C6.

### Per-account throttle cap (DoS fix) — 🟡
- **DO** keep a generous per-account concurrency ceiling; a 15-league fan-out is a normal
  power-user action, not abuse.
- **DON'T** set the per-account cap so low it throttles your most engaged users.

### zod / schema validation at the API boundary — 🟡
- **DO** fail **soft**: log the drift, render what's valid.
- **DON'T** let a schema mismatch reject a whole response and blank a screen (violates C4).

### Font un-await (cold start) — 🟡
- See C9. Make it a deliberate trade, gated + swap-free — not a blind flip.

---

## 3. Safe sequence — the sequencing *is* the risk mitigation

1. **Phase 0 first (all invisible/positive):** the login-crash fix, SSRF allowlist, CORS,
   demo-mode assertion, dep floors/`npm ci`, bound the leaky cache, `.env` fix,
   `allowBackup=false`, scheme allowlist. Zero UX risk; several improve reliability.
2. **Build the safety net before the big refactor:** ESLint + a CI gate running
   `smoke:all`, glob the test registry, and — critically — encode C1–C4, C6, C10 as tests
   (a mobile render/interaction smoke test + backend units). Refactoring the nav/cache layer
   on a codebase with **no automated tests** is the real hazard.
3. **Then Phase 1 (nav + cache),** behind that net, respecting §2.
4. **Then Phase 2–4** (shared package, zod, MFL repo, perf polish, coverage).
5. **Defer Phase 5** (demo/live seam, persistence scaling, full TS) until it pays.

**Timing:** do the wobble-prone work (nav + cache overhaul, Portfolio rework, font change)
in the **offseason** (summer). It is far safer than trade-deadline week, fantasy playoffs,
or rookie-draft season, when dynasty users are in the app daily making high-stakes moves.

---

## 4. Pre-merge UX checklist

For any PR touching navigation, the cache/data layer, lists, animations, or error surfaces,
the reviewer confirms:

- [ ] **C1** Return to a tab paints instantly — no spinner/blank frame.
- [ ] **C2** Read-only away-and-back within the window does **not** refetch.
- [ ] **C3** After a write, the affected screen reflects it on next view (not after a delay).
- [ ] **C4** A failed background refresh keeps existing data (no blank/error takeover).
- [ ] **C5** Partial-data failures stay quiet; only session-expiry surfaces loudly.
- [ ] **C6** Trade-builder preview updates with zero latency per toggle.
- [ ] **C7** Scroll position + in-progress trade survive a detail-screen round-trip.
- [ ] **C8** Entrance/press/count-up animations intact; first screenful animates.
- [ ] **C9** Cold start paints fast with no font pop on the hero.
- [ ] **C10** Free/draftable + FAAB still render correctly.
- [ ] **C11** Any new cache/store is cleared on logout + auth-loss.

If a change **intentionally** alters one of these, it needs an explicit note in the PR and
sign-off — the contract can change, but only on purpose, never as a side effect.
