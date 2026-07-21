# Lessons Learned

War stories and the takeaways that came out of them. The crisp, enforceable version
of these lives in [`CLAUDE.md`](../CLAUDE.md) under **Hard-won rules**; this file keeps
the *why* so we don't relearn it the hard way.

---

## 1. The Great Launch Crash (2026-07)

**Symptom.** Every fresh Android build died at the "navy flash" — the splash appeared,
then the app closed before the login screen. Meanwhile OTA updates kept "reverting to
the old app," and the owner reported never seeing the new animation.

**Dead ends we chased and ruled out**, in order:
1. The login → home animation (removed it — still crashed).
2. `react-native-svg` in the app-wide backdrop (built an SVG-free version — still crashed).
3. `expo-updates` / OTA (removed it entirely — still crashed).
4. `expo-notifications` / FCM init at boot (a plausible, scary suspect — but wrong).

**How we actually found it.** A **bare-metal build** — `App.js` reduced to a static
`react-native`-only screen with every native module stripped — *launched cleanly*. That
one data point split the entire problem space: the device, the EAS pipeline, and the
Expo runtime were all healthy, so the fault was in our own code.

**Root cause.** `App.js` used `useRef` (the login fly-away animation value) but never
imported it. That's a `ReferenceError` thrown in the **root component's own render** — so
it crashed at the first frame, and no error boundary could catch it. The bug had existed
since the first animation commit (#124), which is exactly when OTA updates started
rolling back to the embedded bundle.

**Takeaways:**
- An **ErrorBoundary cannot catch a throw in the root component's own body** — only in
  its descendants. A crash "the boundary didn't catch" points *up*, not down.
- **Metro bundling and parse-checks are not runtime checks.** An undefined-variable bug
  (`useRef` not imported) bundles and ships fine, then crashes on device. A lint rule
  with `no-undef` would have caught it in seconds.
- **A bare-metal isolation build is the fastest way to split "our code" vs
  "environment."** When you're guessing suspects one at a time and not converging, stop
  and bisect the whole space in half instead.
- **Follow the evidence, not the scariest-looking suspect.** `expo-notifications` *felt*
  dangerous (FCM at boot), but git history showed it had shipped for months and that
  `useRef` predated every crash. We nearly deleted a working feature (push) for nothing.
- **An entrance animation that starts hidden can strand the app.** The fix keeps the
  "fall-in" value at its *settled* default, so it only animates right after an explicit
  login and is a no-op on every other render.

---

## 2. MyFantasyLeague (MFL) integration gotchas

- **Franchise ids are 4-digit zero-padded** (`0005`, not `5`). A future-pick trade token
  with an unpadded owner id (`FP_5_2027_1`) makes `tradeProposal` **500**. Always pad.
- **Future picks are `FP_<originalOwner>_<year>_<round>`.** The owner is the *original*
  owner (`originalPickFor`), which can differ from the current holder and can come back
  unpadded.
- **`myleagues` is year-scoped** — the season is in the URL path (`/2026/export`). A
  league not yet rolled into the season won't appear.
- **429s are the default failure mode.** Static/slow MFL types are cached (5-min / 30-min
  TTLs); bursts are throttled and retried with backoff. Don't fan out uncached.
- **Surface MFL's error body.** MFL reports problems both as a 200 body `{"error": …}`
  *and* as raw 500s with a message in the body. Throwing away everything but the status
  code makes real bugs undebuggable — bubble up `mflError` / `body`.
- **Parallelize independent per-league fan-outs.** The player profile once ran its four
  live sections (game log, schedule, news, cross-league roll-up) sequentially, so its
  latency was their *sum*. `Promise.all` made it the slowest single section.

---

## 3. Build & deploy pipeline

- **EAS builds run via GitHub Actions**, not locally — the sandbox proxy blocks
  `api.expo.dev`. The `eas-build` / `eas-status` workflows kick and report builds;
  `EXPO_TOKEN` is a repo secret (never committed).
- **`versionCode` auto-increments, but you must uninstall first.** Installing a build
  over an existing app with the same/older versionCode silently no-ops. When testing a
  new build: uninstall, then install.
- **Backend changes deploy via Render on merge to `master` — no app build.** This is the
  fast path: a backend fix (perf, MFL bug) is live minutes after merge with no reinstall.
  Only mobile changes need a ~10-minute EAS build.
- **OTA (`expo-updates`) was removed.** A blank/crashing OTA bundle triggers a rollback to
  the embedded build and then rejects newer updates, which produced the confusing
  "reverted to the old app" symptom during the launch-crash saga.

---

## 4. Product philosophy

- **No silent state changes.** "Muting" a league removed it from Home with no indication,
  so two mis-tapped mutes read as "the app lost 2 of my 15 leagues." We first made the
  count honest, then removed muting entirely. If an action hides data, it must *show* that
  it did.
- **Optimistic UI, always reversible.** Inline Target/Avoid/Watch flips immediately and
  reverts on a failed write. Fast and honest beats correct-but-laggy.
- **Transparency over magic.** Show the math (`You get 64 · send 67 · Fair deal`), name
  the risk (`Strips their RB/WR starter`), and never let a control do something the user
  can't see.
