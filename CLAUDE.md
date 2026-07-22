# Project notes for Claude

## Project

**Dynasty Central** — an Android app (Expo/React Native) + Node/Express backend for
managing multiple MyFantasyLeague dynasty leagues from one place. See `README.md`
for architecture and the milestone roadmap. `backend/` runs in DEMO mode with zero
config; `mobile/` is the Expo app.

## Working preferences

- **Solo project — no PR approval needed.** It's just the owner (dbressler85) and
  Claude. GitHub blocks the authoring account from approving its own PR, and there's
  no second reviewer, so don't wait on or ask for approvals. Open PRs when asked and
  **merge directly** (squash) once the work is verified. Branch protection does not
  require reviews.

## Planning & review docs

- [`docs/ARCHITECTURE_REVIEW.md`](docs/ARCHITECTURE_REVIEW.md) — third-party architecture +
  security findings and the phased roadmap (Phase 0 quick wins → structural bets). Start here
  before large refactors.
- [`docs/UX_GUARDRAILS.md`](docs/UX_GUARDRAILS.md) — **protected UX contracts** (instant paint,
  no-reload-on-read-nav, reflect-action-immediately, non-destructive errors, instant local trade
  preview, scroll survival, live animations, logout wipe, …). Any PR touching navigation, the
  cache/data layer, lists, animations, or error surfaces must satisfy these and the pre-merge
  checklist. Treat them as enforceable, not advisory.

## Hard-won rules

The crisp, enforceable version of the lessons in [`docs/LESSONS.md`](docs/LESSONS.md).
Respect these on every change.

### Security
- The user's MFL password **never** reaches our storage — the password flows
  app → backend → MFL only; the backend keeps just the session cookie (encrypted when
  `SESSION_SECRET` is set).
- `EXPO_TOKEN` is a CI secret only — never commit it.

### MFL integration
- **Zero-pad franchise ids to 4 digits** wherever they go into a token or request
  (`FP_0005_2027_1`, never `FP_5_…`). Unpadded ids 500 the MFL trade API.
- Future picks are `FP_<originalOwner>_<year>_<round>`; the owner is the *original* owner.
- Always **surface MFL's error detail** (`err.mflError` / `err.body`), never just the
  status code — a bare "(500)" is undebuggable.
- Cache the static/slow MFL types; **parallelize independent per-league fan-outs**
  (`Promise.all`), never run them in sequence.

### Mobile
- **Every hook and identifier must be imported.** An undefined variable (e.g. `useRef`)
  bundles fine and then crashes at runtime — a `ReferenceError` in the **root component**
  is uncatchable by any ErrorBoundary. Keep `no-undef` honest.
- Entrance animations must **default to their settled state** so a render that doesn't
  animate can never strand or blank the app.
- "It works" means a **real EAS build, uninstalled then reinstalled** — not a parse-check
  and not the simulator. `versionCode` auto-increments but installs no-op over an existing
  app, so uninstall first.

### Workflow
- **Backend changes deploy via Render on merge to `master` — no app build.** Prefer the
  backend for fixes that can live there; only mobile changes need a ~10-min EAS build.
- **Never auto-trigger an EAS build.** EAS builds are a *scarce* monthly credit (Standard
  plan, and the month's credits are routinely used up), so a wasted build has real cost.
  Mobile changes accumulate on `master`; only the owner *starts* a build. Suggesting one is
  welcome — when a batch of mobile work is at a coherent, verified stopping point, say so and
  let the owner decide. Never build after every prompt/merge, and never build just to "check."
- Squash-merge to `master`; keep the dev branch reset to `master` after each merge.
- Commits are authored as `Claude <noreply@anthropic.com>`; the model id never appears in
  any pushed artifact (commits, code, PRs).
