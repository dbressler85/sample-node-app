# Dynasty Central

Manage all your [MyFantasyLeague](https://home.myfantasyleague.com) dynasty
leagues from one Android app — instead of navigating to each league one by one.

**Status:** Milestone 4 — a cross-league **command center** (portfolio, triage,
live scoreboard, player exposure) with **lineup management** (availability-aware
"Set All"), **waivers / FAAB / free agents**, and a **player hub**. Manage claims per league across
all three MFL pickup systems, and a **player hub** — search any player, see his
stats/projection and every league you roster him in, and **add or drop him across
leagues at once**. Smart drop + bid guidance throughout. Trades are next.

## Architecture

```
┌─────────────────┐        ┌──────────────────────┐        ┌───────────────────┐
│  Expo / RN app  │  HTTPS │  Node/Express backend │  HTTPS │  MyFantasyLeague  │
│  (your phone)   │ ─────▶ │  (you host this)      │ ─────▶ │  export / import  │
│  Bearer token   │        │  holds MFL session,   │        │  API              │
│                 │ ◀───── │  aggregates leagues   │ ◀───── │                   │
└─────────────────┘        └──────────────────────┘        └───────────────────┘
```

The backend is **required**, not optional: MFL blocks generic clients, throttles
requests, and credentials must never live in a phone app. One MFL login unlocks
*all* your leagues via MFL's `myleagues`, which is what makes the centralized
view possible.

- **[`backend/`](backend/README.md)** — Express aggregation API + MFL client. Runs
  in DEMO mode out of the box (fixture data, no account needed).
- **[`mobile/`](mobile/README.md)** — Expo/React Native app (login, dashboard, roster).

## Quick start (demo, on a computer)

```bash
# Terminal 1 — backend with fixture data
cd backend && npm install && npm start

# Terminal 2 — app (point it at the backend's LAN IP for a real device)
cd mobile && npm install && EXPO_PUBLIC_API_URL=http://<lan-ip>:4000 npx expo start
```

Any username/password logs you into demo mode. See each sub-README for going live
and for building an installable APK **without a computer** (Expo EAS cloud build).

## Test it on your phone (no computer needed)

Two things must be online: the backend (a public URL) and the app (an installed APK).

1. **Deploy the backend (free, ~3 min).** In [Render](https://render.com): New →
   **Blueprint** → connect this repo. It reads [`render.yaml`](render.yaml) and
   stands up the backend in DEMO mode with zero config. Copy the URL it gives you
   and sanity-check it in your phone browser at `<url>/api/health` →
   `{"ok":true,"demoMode":true}`.
2. **Get an Expo token.** Free account at [expo.dev](https://expo.dev) → create an
   access token → add it as the GitHub repo secret **`EXPO_TOKEN`**
   (Settings → Secrets and variables → Actions).
3. **Build the APK.** GitHub → **Actions** tab → *Build Android APK (EAS)* →
   **Run workflow**, pasting your Render URL. EAS builds it in the cloud and prints
   a download link (the first run also links the Expo project and generates the
   Android keystore automatically).
4. **Install.** Open the link on your phone → allow "install unknown apps" →
   install → open → log in (any username/password works in demo).

Every step is doable from the phone's browser.

### Staying logged in (Render notes)

Render's **free** plan sleeps after ~15 min idle and wipes its filesystem on every
restart, so the first request after a while takes ~30s to wake — and because the
in-memory sessions are gone on wake, **you get logged out** (and the push scheduler
isn't running while it's asleep). The app no longer logs you out on a transient
wake blip, but once the backend has actually restarted, the old token is invalid.

To stay logged in for real (and keep push notifications working), make it always-on
with durable storage — all wired in [`render.yaml`](render.yaml):

1. Set the service to **`plan: starter`** (always-on, no idle sleep).
2. Add a **Render Disk** (uncomment the `disk:` block, mount `/var/data`) and set
   **`DATA_DIR=/var/data`** so state lands on the disk, not the ephemeral filesystem.
3. Keep **`SESSION_SECRET`** (auto-generated in the blueprint) — with a secret + a
   durable `DATA_DIR`, sessions are **encrypted at rest** and restored on boot, so
   restarts and redeploys don't log anyone out.

Free-tier stopgap (no cost): point an uptime pinger (UptimeRobot / cron-job.org) at
`<url>/api/health` every ~10 min to keep it awake. That preserves sessions between
deploys, but a redeploy still resets them — the paid plan + disk is the robust fix.

## Roadmap

- [x] **M1 — Dashboard (read-only):** all leagues, matchups, live scores, standings, rosters
- [x] **M1.5 — Command Center:** portfolio roll-up + cross-league triage queue, live scoreboard (players-yet-to-play + win probability), player-exposure view, news→impact mapping, and dynasty roster context (age/value/picks)
- [x] **M2 — Lineups:** format-aware optimizer (per-league PPR / TE-premium / pass-TD scoring), per-league editor, and one-tap "Set All Lineups" (`import?TYPE=lineup`)
- [x] **M2.5 — Safe & informed Set All:** availability-aware (never starts OUT / injured / bye players), floor/ceiling + matchup with win probability, safe/balanced/aggressive modes, and a review-diff before bulk apply
- [x] **M3 — Waivers / FAAB:** per-league board for all three MFL systems (FAAB / FCFS / free agents), filter/sort, cross-league best-available, smart drop + bid guidance, validated claim/cancel
- [x] **M4 — Player hub:** universe search + rankings, rich profile (projection/floor/ceiling, game log + season, schedule difficulty, cross-league ownership), and player-centric **add/drop across leagues**
- [ ] **M5 — Trades:** propose / counter / accept / reject, launched from the player profile
- [ ] **M6 — Hardening:** lock deadlines, push notifications, persistent session store, live-MFL verification, Play Store

## Notes on live MFL

Live-mode request/response shapes follow the
[MFL API docs](https://api.myfantasyleague.com/2020/api_info?STATE=details) but
have not yet been exercised against a real account in this repo — see
[`backend/README.md`](backend/README.md#going-live--what-still-needs-verifying).
