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
| GET | `/api/lineups` | Cross-league lineup overview: current vs optimal points + gap per league |
| POST | `/api/lineups/apply` | **Set all lineups** — optimize every non-optimal league in one call |
| GET | `/api/leagues/:leagueId/lineup` | Lineup detail: slots with current + optimal picks, for editing |
| POST | `/api/leagues/:leagueId/lineup` | Set one league's lineup (`{starters:[ids]}`, or optimal if omitted) |

## Layout

```
src/
  config.js            env-driven config
  lib/mfl.js           low-level MFL client (host routing, UA, throttle, login)
  lib/players.js       cached player-id -> name/team/pos resolution
  lib/optimizer.js     pure lineup optimizer (slot expansion + best assignment)
  lib/scoring.js       scoring engine (projected stats x league scoring -> points)
  store/sessions.js    token -> MFL cookie (in-memory)
  store/lineups.js     applied lineups per session (in-memory)
  services/            leagues, dashboard, roster, lineups
  routes/              auth + api + lineup routes
  demo/fixtures.js     DEMO_MODE data (rosters, projected stats, scoring, lineup rules)
```

## Going live — what still needs verifying

The MFL read/write shapes are coded to the [public API docs](https://api.myfantasyleague.com/2020/api_info?STATE=details)
but haven't been run against a real account here. Before trusting live mode,
verify against your own leagues: `login`, `myleagues`, `liveScoring`, `schedule`,
`leagueStandings`, `rosters`, `players`, and — for lineups — `projectedScores`
(used directly as format-aware projections in live mode) plus parsing each
league's starting requirements from `league`.

**Scoring/format awareness.** The optimizer is format-aware: projections are the
player's projected points *in each league's scoring* (PPR, TE premium, pass-TD
value, etc.), so the same player is ranked differently per league. In demo mode
this is computed as projected stats × the league's scoring (`lib/scoring.js`); in
live mode MFL's per-league `projectedScores` already reflect the league's scoring.
Parsing MFL's raw scoring rules into `lib/scoring.js` settings (to compute from
stats live, and to show the format label) is a follow-up.
