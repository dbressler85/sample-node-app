# Dynasty Central — Backend

Node/Express aggregation layer between the mobile app and MyFantasyLeague (MFL).

**Why a backend at all?** MFL blocks generic clients, requires a descriptive
User-Agent, throttles requests, and must never see the app embed credentials.
So the phone talks only to this service, which holds the MFL session, respects
rate limits, and aggregates data across every league on your account.

## Run it

```bash
cd backend
npm install
npm start          # boots in DEMO mode on http://localhost:4000
npm run smoke      # end-to-end self-test (login -> dashboard -> roster)
```

DEMO mode (the default) serves fixture data — no MFL account required. Flip to
live MFL with `MFL_DEMO_MODE=false`. See `.env.example` for all settings.

## How auth works

1. `POST /api/auth/login {username, password}` → backend logs into MFL once,
   gets the `MFL_USER_ID` cookie, stores it server-side, and returns an opaque
   app token.
2. The app sends `Authorization: Bearer <token>` on every request. The backend
   swaps it for the MFL cookie. The phone never holds MFL credentials or the cookie.

> Sessions are currently in process memory (`src/store/sessions.js`) — fine for a
> single-user MVP, but swap in Redis/an encrypted store before hosting for real.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + mode |
| POST | `/api/auth/login` | Log into MFL, get app token |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/dashboard` | One card per league: matchup, live score, record, standing |
| GET | `/api/leagues` | Flat list of all leagues on the account |
| GET | `/api/leagues/:leagueId/roster` | Your roster (names resolved), bucketed by starters/bench/IR/taxi |

## Layout

```
src/
  config.js            env-driven config
  lib/mfl.js           low-level MFL client (host routing, UA, throttle, login)
  lib/players.js       cached player-id -> name/team/pos resolution
  store/sessions.js    token -> MFL cookie (in-memory)
  services/            leagues (myleagues), dashboard aggregation, roster
  routes/              auth + api routes
  demo/fixtures.js     DEMO_MODE data
```

## Going live — what still needs verifying

The MFL read/write shapes are coded to the [public API docs](https://api.myfantasyleague.com/2020/api_info?STATE=details)
but haven't been run against a real account here. Before trusting live mode,
verify against your own leagues: `login`, `myleagues`, `liveScoring`, `schedule`,
`leagueStandings`, `rosters`, `players`. Write actions (lineups/waivers/trades)
are the next milestone and are not implemented yet.
