# MFL API usage audit

**Purpose.** A source-of-truth check: how *we* call MyFantasyLeague's API (extracted authoritatively
from the code) vs. what MFL's documentation says we *should* do. The left side (our usage) is exact.
The right side (correctness) needs the **authenticated MFL Developer docs** the owner can see and the
assistant cannot — so each row carries a **status** and, where it matters, a **specific question** to
answer from those docs. Fill in / correct the "Verify" column, then we turn the findings into changes.

- **Canonical docs:** https://api.myfantasyleague.com/2020/api_info (public info page) + the
  authenticated Developer Program pages behind the owner's login.
- **How we call MFL:** `backend/src/lib/mfl.js` (`exportRequest` reads, `importRequest` writes),
  normalized in `backend/src/lib/mflRepo.js`. Every request sends the validated User-Agent
  (`dynasty-central`) and the session cookie; hosts are pinned to `*.myfantasyleague.com` (SSRF guard).
- **Status legend:** ✅ works in live + matches our understanding · ⚠️ works but a param/field is
  worth confirming · ❓ needs the docs to confirm we're correct/optimal · 🔴 write op — confirm carefully.

---

## 0. Findings applied from the MFL Developer Program overview (source of truth)

The owner pasted MFL's authenticated Developer Program overview page. Confirmed facts and the
changes we shipped from them:

- **Client identity / auth.** MFL authenticates a client by its **registered + validated
  User-Agent** (`dynasty-central…`) — there is **no API key to paste**. The optional per-account
  `APIKEY` is export-only and *not* required for our throughput. ✅ We already send the UA; no change.
- **Rate limits are unpublished and variable.** MFL does **not** state a fixed request ceiling; a
  registered client simply gets limits **~2.5× higher** than an unregistered one, and limits are
  **lower during games**. So there is no number to code to — the throttle stays **empirical/adaptive**
  (8/75 via env, with the 429/503 cooldown). ✅ No throttle-rate change (we corrected an earlier
  misreading that treated "wait a second" as a hard 1/sec cap).
- **"If a request fails, don't retry."** → **Applied.** A **429 is no longer retried**: we cool down
  (adaptive backoff, floored to 8× the min interval), **surface the failure** to the fail-soft caller,
  and **log** it (`[MFL 429] …`) so the real limit is visible from live signal. A **503** (transient
  server error, not rate limiting) keeps a bounded backoff-retry. (`mfl.js` retry loop.)
- **Player DB changes once a day; request it no more than once a day.** → **Applied.** Split
  `players` + `nflSchedule` into a new **daily TTL tier** (`mflDailyTtlMs`, 24h) instead of the 1h
  static tier — we were re-downloading the whole player universe ~24× more than MFL asks.
- **Login.** ✅ MFL's own **official sample code uses GET** `login?USERNAME=&PASSWORD=&XML=1` and reads
  the cookie from the response (`MFL_USER_ID="…">OK`) — which is *exactly* what we do. So GET is **not**
  wrong; it's the documented example. POST is only a *credentials-hygiene* option (keeps user/pass out of
  the URL / upstream access logs). Optional, owner-gated, and needs a real-login test before switching —
  not a bug.
- **Player ids** are 4–5 digit strings; ids **under 1000 need a leading zero** (`0531`). **Franchise
  ids** are 4-digit (`0001`; `0000` = commissioner). ✅ We already 4-pad franchise ids; confirm the
  player-id padding on any id we format into a token.
- **Hosts.** Non-`L` (account-level) requests must use host **`api`**; per-league requests use the
  league's own host from `myleagues`. ✅ Matches our routing.
- **JSON output** via `JSON=1` (XML is the default). ✅ We send `JSON=1`.

---

## 0b. Findings from the Export Request Reference page (source of truth)

The owner pasted MFL's authenticated **Export** request reference. (The **Import**/write reference is a
separate tab and still needed — the 🔴 write rows in §2 stay open until we have it.) Parsed findings:

**Shipped this pass (deploy-safe backend):**
- **`pendingTrades` param is `FRANCHISE_ID`** (we were sending `FRANCHISE`). Corrected at both call
  sites. Benign for owners (cookie scopes it), but the doc name is now honored; `0000` fetches trades
  pending commissioner action.
- **`transactions` now bounded with `COUNT`.** The doc explicitly warns the full set is large and
  recommends filtering; we only render the newest `limit`, so MFL truncates server-side.

**Confirmed correct (no change):**
- **Trade-asset token formats** (from `tradeBait`'s `INCLUDE_DRAFT_PICKS` note) — matches our rules
  exactly: current-year pick `DP_<round-1>_<pick-1>` (both one **less** than the actual round/pick);
  future pick `FP_<originalOwnerId4>_<year>_<round>` (round is the **actual** round); blind-bid dollars
  `BB_<amount>`. Franchise `0000` = commissioner. This de-risks the trade-write audit.
- **`playerScores`** — `W` accepts `YTD`/`AVG`; `RULES` recalcs to a league's scoring (current
  year+week only); `YEAR`/`PLAYERS`/`POSITION`/`STATUS=freeagent`/`COUNT` all available. Our usage
  (`W`,`PLAYERS`) is valid.
- **`projectedScores`** — `PLAYERS`/`POSITION`/`STATUS`/`COUNT`; omitting `W` correctly defaults to the
  upcoming week. (No `RULES` param here — that's `playerScores` only.)

**Opportunities queued (need a response-shape check or touch trade/value logic — not auto-applied):**
- **`players?SINCE=<unix ts>`** — incremental player-DB deltas. After the first full daily load, a
  refresh could pull only changes. Medium effort (merge deltas into the cached map); biggest cold/refresh
  win left. → new task.
- **`nflSchedule?W=ALL`** — returns the **full season in one call**. `nfl.js#upcomingOpponents` currently
  loops one `nflSchedule?W=<n>` per week (sequential per-week fan-out). Collapsing to one `W=ALL` fetch
  needs the ALL response shape confirmed (per-week nesting) before changing. Also a dedicated
  **`nflByeWeeks`** endpoint exists (we derive byes by scanning the player pool vs the week's matchups).
- **`assets`** — "all tradable assets (players, current + future picks)" in one read; could simplify trade
  construction (today we compose from `rosters` + `futureDraftPicks`). Touches trade logic → careful.
- ✅ **`playerRosterStatus?P=`** — reader + normalizer shipped (`mflRepo.playerRosterStatus` +
  `addEligibility`), confirmed against a live sample (`playerRosterStatuses.playerStatus[]`;
  `roster_franchise` object-or-array, `is_fa`/`cant_add`/`locked`, per-player `error`). Ready to power
  authoritative add eligibility on the immediate-add path (**#71**) — deliberately NOT gating FAAB/priority
  claims (a claim is a bid, not a direct add).
- ✅ **`pendingWaivers`** — reader shipped (`mflRepo.pendingWaivers`), confirmed against a live sample
  (`pendingWaivers.blindBidWaiverRequest` with `round`/`timestamp`/`comments`/`addsDrops`). Two payoffs:
  (a) it **validates the FAAB write fix** — the stored `addsDrops="14080_0_14849,…"` is exactly the
  `add_bid_drop` PICKS format we now send; (b) it carries the waiver **`round`**, the value we needed to
  unblock FCFS submission and conditional-FAAB (**#71**). Truthful pending view (vs the local store) is a
  follow-up (needs mobile).
- **`leagueStandings?COLUMN_NAMES=1`** — returns the column key→name mapping (and canonical order), so we
  wouldn't guess `h2hw`/`pf`/`pa` field names.
- **`adp`** dynasty tuning — `IS_KEEPER` (`K`/`R`/`N` combos), `FCOUNT`, `IS_PPR`, `CUTOFF`. Our value
  model sends only `PERIOD=RECENT`; dynasty relevance might warrant `IS_KEEPER`. **Value-model change —
  owner's call.**
- **`playerProfile`** (DOB, ADP rank, height/weight) and **`playerRanks?POS=&SOURCE=`** — could enrich the
  player hub.

**Noted, no action:** MFL has a native **`myWatchList`** — we built our own richer cross-league watchlist,
so we keep ours. Endpoints we don't use but exist if ever needed: `weeklyResults`, `auctionResults`,
`salaries`/`salaryAdjustments`, `accounting`, `playoffBrackets`, `whoShouldIStart`, `pointsAllowed`.

---

## 1. READ endpoints (export?TYPE=…)

### Per-league reads (send `L`, `host`, cookie; extras noted)

| TYPE | Extra params we send | Envelope path we read | Fields we consume | Status · Verify from docs |
|---|---|---|---|---|
| `league` | — (and a `maxAge`-fresh variant for waiver settings) | `league.franchises.franchise[]`; also `league.{bbidSeasonWaivers,bbidWaivers,bbidTotalBalance,playoffTeams,…}` | franchise id/name; waiver/FAAB flags; playoff teams | ⚠️ Are the FAAB fields (`bbidTotalBalance`/`bbidBudget`/`faabBudget`, `bbidAvailableBalance`) the correct/current names? We try several — which is canonical? |
| `rules` | — | scoring rules | PPR / TE-premium detection | ❓ Is `rules` the right export for scoring, and are we reading the rule structure correctly (vs `league` settings)? |
| `rosters` | `FRANCHISE` (optional) | `rosters.franchise[].player[]` | player id + `status`/`roster_status` (starter/IR/taxi buckets) | ✅ — but confirm the status codes we bucket on (`INJURED_RESERVE`, `TAXI_SQUAD`, `starter`) are the exact documented values. |
| `leagueStandings` | — (`COLUMN_NAMES=1` for the key→label map) | `leagueStandings.franchise[]` | h2hw/l/t, pf, pa (+ strk, all_play_pct, h2hpct, pp) | ✅ **Confirmed** against a live `COLUMN_NAMES=1` sample: `h2hw`/`h2hl`/`h2ht`/`pf`/`pa` are exactly MFL's ids. Now also surface `strk`, `all_play_pct`, `h2hpct`, `pp` (FAAB `bbidbalance` also present). |
| `liveScoring` | — (`DETAILS=1` available) | `liveScoring.franchise[]`; `liveScoring.week`; franchise `players.player[]` | score, playersYetToPlay, projectedScore, gameSecondsRemaining, opp_id | ⚠️ Doc confirms the endpoint returns each franchise's score, game-seconds-remaining, players-yet-to-play, and currently-playing players; **`DETAILS=1`** additionally returns non-starters. Exact child attribute spellings still to confirm from the response sample. |
| `freeAgents` | — | `freeAgents.leagueUnit.player[]` | player ids (cap 300) | ✅ Only filter MFL offers is `POSITION` (no COUNT). We fetch all and slice client-side, which is fine since best-available spans positions; add `POSITION` only if a caller ever wants one slot. |
| `projectedScores` | `W` (optional) | `projectedScores.playerScore[]` | id, score | ❓ Does this need `W`/`COUNT`/`RULES` params to be accurate? We sometimes omit `W`. |
| `playerScores` | `W`, `PLAYERS` | `playerScores.playerScore[]` | id, score | ❓ Correct params for a single player's week/YTD/avg score? |
| `schedule` | `W` (optional) | `schedule.weeklySchedule[].matchup[].franchise[]` | opponent lookup | ⚠️ Is `weeklySchedule[].matchup[].franchise[]` the right nesting for the current season? |
| `calendar` | — | `calendar.event[]` | waiver lock/unlock windows (text-scanned) | ❓ Is there a structured field for waiver open/close instead of scanning event text? |
| `pendingTrades` | `FRANCHISE_ID` *(was `FRANCHISE` — fixed)* | `pendingTrades.pendingTrade[]` | trade_id, offeredto, will_give_up/will_receive, expiration, comments | ✅ Param corrected to `FRANCHISE_ID` (doc name; only honored for a commissioner — an owner's cookie already scopes it). `0000` = trades pending commissioner action. Attribute names still matched defensively. |
| `transactions` | `COUNT` *(newly added)* | `transactions.transaction[]` | type, timestamp, franchise, transaction payload | ✅ Now bounded with `COUNT` (doc warns the full set "can be a very large set"). Other filters available if needed: `TRANS_TYPE` (WAIVER, BBID_WAIVER, FREE_AGENT, WAIVER_REQUEST, BBID_WAIVER_REQUEST, TRADE, IR, TAXI, AUCTION_*, SURVIVOR_PICK, POOL_PICK; `*`/`DEFAULT`/CSV), `DAYS`, `FRANCHISE`, `W`. |
| `draftResults` | — | `draftResults.draftUnit[].draftPick[]` | round/pick/franchise/player, unit=LEAGUE | ⚠️ Multi-unit (division) drafts — do we handle `draftUnit` selection right (we pick unit==='LEAGUE' else [0])? |
| `futureDraftPicks` | `FRANCHISE` (optional) | future picks | pick ownership (FP tokens) | ❓ Confirm the export name/shape for **future** (not current-year) picks. |
| `tradeBait` | — | `tradeBaits.tradeBait[]` | franchise_id, willGiveUp | ⚠️ Note TYPE is `tradeBait` but envelope is `tradeBaits.tradeBait` — confirm. |

### Global reads (no `L`; host = api host)

| TYPE | Params | Reads | Status · Verify |
|---|---|---|---|
| `myleagues` | `FRANCHISE_NAMES=1` | `leagues.league[]` (bootstrap: which leagues + host + franchise) | ✅ confirm `FRANCHISE_NAMES` is the right flag + response shape. |
| `players` | `DETAILS=1` | full player universe (`players.player[]`) | ✅ Cached 24h (daily tier). **`SINCE=<unix ts>` confirmed** — returns only DB changes since a timestamp, so a refresh after the first full load can be a cheap delta instead of re-downloading ~2,000+ players. Also `PLAYERS=<csv>` for a targeted subset. (Incremental merge = a queued opportunity, see §0b.) |
| `injuries` | `W` | `injuries.injury[]` | status/details | ✅ confirm current-week semantics. |
| `nflSchedule` | `W` (or none) | `nflSchedule.{week,matchup}[]` | bye/schedule | ⚠️ Confirm with/without `W` behavior. |
| `adp` | `PERIOD=RECENT` | ADP | draft value model | ❓ Are `PERIOD` + other params (FCOUNT, IS_PPR, etc.) set optimally? |
| `topAdds` | — | trending adds | waiver "trend" | ❓ Params (W, COUNT)? Are we getting the window we intend? |
| `topOwns` | — | ownership % | player ownership | ❓ Params/period correct? |

---

## 2. WRITE endpoints (import?TYPE=…) — confirm carefully 🔴

Writes are the highest-risk: a wrong param can fail silently or do the wrong thing to a real league.
(Reminder from our rules: **zero-pad franchise ids to 4 digits**; **always surface `err.mflError`**.)

**Import mechanics — ✅ confirmed against MFL's official sample code** (the API Test Area page):
`POST protocol://<league_host>/<year>/import?L=<id>&TYPE=<type>` with any XML payload sent as a
form-encoded `DATA=<xml>` field in the body (`Content-Type: application/x-www-form-urlencoded`);
imports without a `DATA` arg can go via GET. **Our `importRequest` matches this**: `method:'POST'`,
`Content-Type` set, params (incl. any `DATA`) URL-encoded in the body, `TYPE` in the query. What's
still missing is the **per-type Import *reference*** (the args each write TYPE expects) — the sample
page only demonstrates `auctionResults`. The rows below stay open until we have that reference.

Audited against the **Import request reference**. Verdicts:

| Our call (file) | TYPE / params we send | Verdict vs. the Import reference |
|---|---|---|
| `lineup` (`lineups.js`) | `L`,`W`,`STARTERS`(csv),`FRANCHISE` | ✅ **Correct.** Doc: `L`,`W`,`STARTERS`(csv),optional `COMMENTS`/`TIEBREAKERS`. (`FRANCHISE` → see note below.) |
| `tradeProposal` (`trades.js`) | `OFFEREDTO`,`WILL_GIVE_UP`,`WILL_RECEIVE`,`COMMENTS`,`FRANCHISE` | ✅ **Correct.** Optional `EXPIRES` (Unix; defaults to +1 week) available if we want to set it. |
| `tradeResponse` (`trades.js`) | `TRADE_ID`,`RESPONSE`(accept/reject),`FRANCHISE` | ✅ **Correct.** `RESPONSE` also allows **`revoke`** (originator-only) — we don't expose it (missing feature, not a bug). |
| `tradeBait` (`tradebait.js`) | `WILL_GIVE_UP`,`IN_EXCHANGE_FOR`,`FRANCHISE` | ✅ **Correct** (overwrites prior bait, as intended). `tradeBait` has **no** `FRANCHISE_ID` param — the `FRANCHISE` we send is simply ignored. |
| immediate add/drop → `fcfsWaiver` (`waivers.js`) | `ADD`,`DROP` | ✅ **Correct** for the immediate/continuous case (`ADD` single, `DROP` csv). |
| drop a player (`playerhub.js`) | **`fcfsWaiver`** `DROP` *(FIXED)* | ✅ **FIXED** — was TYPE `drop` (doesn't exist). Now `fcfsWaiver` with only `DROP` (immediate drop to FA). |
| FAAB claim (`waivers.js`) | **`blindBidWaiverRequest`** `PICKS="add_bid_drop"` *(FIXED)* | ✅ **FIXED** — was `blindBidWaiver` (bogus TYPE) with ADD/DROP/BID. Now `blindBidWaiverRequest`, `PICKS=<add>_<bid>_<drop|0000>`; `ROUND` omitted (only needed for *conditional* blind bidding). |
| priority claim (`waivers.js`) | **`waiverRequest`** `ROUND`+`PICKS="add_drop"` *(FIXED, #71)* | ✅ **FIXED** — `ROUND` sourced from `pendingWaivers`. If the round can't be determined (locked FCFS with nothing pending yet) we still surface an honest 501 rather than misfile. |
| open free agency (any system) | **`fcfsWaiver`** immediate *(NEW, #71)* | ✅ When the calendar shows the window is OPEN, an add routes to an immediate `fcfsWaiver` add/drop regardless of faab/fcfs — fixes claims outside a waiver period (incl. the offseason). |
| make a pick → `draftPick` (`draft.js`) | **honest 501** *(guarded)* | ✅ **Handled** — no documented live make-a-pick import exists, so live drafting fails fast with a 501 pointing to MFL's draft room (mobile hide staged, task #70). |

**`FRANCHISE` vs `FRANCHISE_ID` (applies to most writes above).** The doc's commissioner-impersonation
param is **`FRANCHISE_ID`**; we send `FRANCHISE`, which is unrecognized and ignored — harmless because the
session **cookie already identifies the owner**. Do **not** blind-rename it: passing `FRANCHISE_ID` as a
*non*-commissioner could trip MFL's commissioner-validation and break a currently-working owner write. The
safe options are to leave it (ignored) or drop it entirely; only wire real `FRANCHISE_ID` if/when we add a
commissioner-impersonation path, and test it live.

**Answered open question:** there is **no separate free-agent "add"** import — an immediate acquisition IS
`fcfsWaiver` (`ADD`, optional `DROP`). Our immediate path already uses it correctly; the bug is only in the
FAAB/priority-round paths (wrong TYPE/shape) and the standalone `drop`.

**Status — shipped (backend, verified by the `waiver-write` live test; pending a real-league smoke by the owner):**
1. ✅ **`drop` → `fcfsWaiver`** with only `DROP`.
2. ✅ **FAAB → `blindBidWaiverRequest`** with `PICKS="add_bid_drop"` (`0000` = no drop), no `ROUND`.
3. ✅ **`draftPick` → 501** (no documented live-pick API); live drafting points to MFL's draft room.
4. ⚠️ **FCFS priority → 501** (guarded). Remaining work: source the current waiver `ROUND`, then submit
   `waiverRequest` with `ROUND` + `PICKS="add_drop"`. Likely not the owner's system (dynasty ≈ FAAB).

**Known limitation (pre-existing, not introduced here):** in live, `loadSettings` classifies every league
as `faab` or `fcfs` (never `free`), so an add during an OPEN free-agency window is still submitted as a
waiver claim rather than an immediate `fcfsWaiver` add. In an active waiver period this is correct; outside
one (e.g. deep offseason) MFL may reject with "no active round" — which we surface. Detecting the
open-FA state (calendar `WAIVER_LOCK`/`UNLOCK`) to route immediate adds through `fcfsWaiver` is a
follow-up.

---

## 3. Auth, rate limits, hosts

| Topic | Our behavior | Verify from docs |
|---|---|---|
| Auth | GET `login?USERNAME=&PASSWORD=&XML=1` → `MFL_USER_ID` cookie; password never stored; cookie encrypted at rest | ✅ **Matches MFL's official sample exactly** (GET login, cookie read from the response, then reused as `Cookie: MFL_USER_ID=…` across leagues). POST-login is an optional credentials-hygiene tweak (owner-gated, needs a live test). |
| Client identity | Validated User-Agent `dynasty-central`; optional `APIKEY` param supported but unused | ✅ Confirm nothing else (referer, etc.) is required for a validated client. |
| Rate limits | Throttle 8 concurrent / 75 ms stagger (with validated client) + adaptive 429 cooldown / 503 backoff | ✅ **Resolved:** MFL publishes **no fixed ceiling** — registered clients get ~2.5× unregistered limits, and limits drop during games. Approach stays empirical/adaptive; 429s are logged (not retried) so the real limit shows in live signal. |
| Host routing | Per-league `host` from `myleagues`; all pinned to `*.myfantasyleague.com` | ✅ Confirm league-specific host usage is correct (vs always api host). |
| Caching | TTL tiers (static/live/slow); coalesced reads | ❓ Any documented cache/`If-Modified-Since` support to avoid re-fetching unchanged data? |

---

## 4. Status — audit complete; remaining work is implementation

Both the **Export** and **Import** references, plus the sample code, have now been checked against our
code. The unknowns are resolved:

- **Reads** — verified; the deploy-safe wins already shipped (§0, §0b), the rest are queued opportunities.
- **Auth / mechanics** — login and import both match MFL's official samples (§2, §3).
- **Writes** — three 🔴 bugs found (`drop`, FAAB/priority waivers, `draftPick`); the rest are correct.

**Remaining work, in priority order** (each 🔴 mutates a real league → live test required before merge):

1. 🔴 **Waiver writes** — the highest-value fix (FAAB is broken today). Rework to
   `blindBidWaiverRequest`/`waiverRequest` with `ROUND` + `PICKS` (§2).
2. 🔴 **`drop` → `fcfsWaiver`** — small, unambiguous; restores a dead feature.
3. 🔴 **`draftPick`** — no documented API; decide demo-only vs. investigate MFL's live-draft mechanism.
4. **Read-side opportunities** (no app build, smoke-verified): `players?SINCE=` incremental merge,
   `nflSchedule?W=ALL` fan-out collapse, and the enrichments in §0b (`assets`, `playerRosterStatus`,
   `leagueStandings?COLUMN_NAMES=1`, `adp?IS_KEEPER=`).
5. **Optional hygiene:** `login` GET→POST (credentials out of the URL); requires a live-login test.

> Read-side fixes ship via Render with no app build and are verified by the smoke/live suite. Write-side
> fixes ship the same way, but **each needs a careful live test against a real league before merge** — a
> wrong write can't be undone by a redeploy.
