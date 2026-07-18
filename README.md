# Dynasty Central

Manage all your [MyFantasyLeague](https://home.myfantasyleague.com) dynasty
leagues from one Android app — instead of navigating to each league one by one.

**Status:** Milestone 3 — a cross-league **command center** (portfolio, triage,
live scoreboard, player exposure) with **lineup management** (availability-aware
"Set All") and **waivers / FAAB / free agents**. Manage claims per league across
all three MFL pickup systems, with smart drop + bid guidance, validation, and a
cross-league best-available view. The player-centric hub and trades are next.

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

## Roadmap

- [x] **M1 — Dashboard (read-only):** all leagues, matchups, live scores, standings, rosters
- [x] **M1.5 — Command Center:** portfolio roll-up + cross-league triage queue, live scoreboard (players-yet-to-play + win probability), player-exposure view, news→impact mapping, and dynasty roster context (age/value/picks)
- [x] **M2 — Lineups:** format-aware optimizer (per-league PPR / TE-premium / pass-TD scoring), per-league editor, and one-tap "Set All Lineups" (`import?TYPE=lineup`)
- [x] **M2.5 — Safe & informed Set All:** availability-aware (never starts OUT / injured / bye players), floor/ceiling + matchup with win probability, safe/balanced/aggressive modes, and a review-diff before bulk apply
- [x] **M3 — Waivers / FAAB:** per-league board for all three MFL systems (FAAB / FCFS / free agents), filter/sort, cross-league best-available, smart drop + bid guidance, validated claim/cancel
- [ ] **M4 — Player hub (player-centric):** search, stats/info, ownership across leagues, player-centric add/drop, then trades
- [ ] **M5 — Hardening:** lock deadlines, push notifications, persistent session store, live-MFL verification, Play Store

## Notes on live MFL

Live-mode request/response shapes follow the
[MFL API docs](https://api.myfantasyleague.com/2020/api_info?STATE=details) but
have not yet been exercised against a real account in this repo — see
[`backend/README.md`](backend/README.md#going-live--what-still-needs-verifying).
