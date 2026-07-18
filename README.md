# Dynasty Central

Manage all your [MyFantasyLeague](https://home.myfantasyleague.com) dynasty
leagues from one Android app — instead of navigating to each league one by one.

**Status:** Milestone 2.5 — cross-league dashboard **plus safe, informed lineup
management**. Log in once, see every team's matchup/score/standing, and set your
lineup in one league or **all leagues at once**. "Set All" is availability-aware
(never starts an OUT/injured/bye player), shows a review diff before writing,
supports safe/balanced/aggressive modes, and surfaces each matchup's win
probability. Waivers → trades are next on the roadmap below.

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
- [ ] **M3 — Waivers / FAAB:** free agents + add/drop + blind-bid claims across leagues
- [ ] **M4 — Trades:** view / propose / accept / reject (`import?TYPE=tradeProposal`)
- [ ] **M5 — Hardening:** persistent session store, live-MFL verification, push alerts, Play Store

## Notes on live MFL

Live-mode request/response shapes follow the
[MFL API docs](https://api.myfantasyleague.com/2020/api_info?STATE=details) but
have not yet been exercised against a real account in this repo — see
[`backend/README.md`](backend/README.md#going-live--what-still-needs-verifying).
