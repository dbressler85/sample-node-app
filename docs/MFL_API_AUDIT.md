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
- **Login should be POST.** MFL recommends POST for `login` (and for imports). ⚠️ We currently GET
  `login?…&XML=1`. Flagged for a careful follow-up (auth critical path; needs a real-login test).
- **Player ids** are 4–5 digit strings; ids **under 1000 need a leading zero** (`0531`). **Franchise
  ids** are 4-digit (`0001`; `0000` = commissioner). ✅ We already 4-pad franchise ids; confirm the
  player-id padding on any id we format into a token.
- **Hosts.** Non-`L` (account-level) requests must use host **`api`**; per-league requests use the
  league's own host from `myleagues`. ✅ Matches our routing.
- **JSON output** via `JSON=1` (XML is the default). ✅ We send `JSON=1`.

---

## 1. READ endpoints (export?TYPE=…)

### Per-league reads (send `L`, `host`, cookie; extras noted)

| TYPE | Extra params we send | Envelope path we read | Fields we consume | Status · Verify from docs |
|---|---|---|---|---|
| `league` | — (and a `maxAge`-fresh variant for waiver settings) | `league.franchises.franchise[]`; also `league.{bbidSeasonWaivers,bbidWaivers,bbidTotalBalance,playoffTeams,…}` | franchise id/name; waiver/FAAB flags; playoff teams | ⚠️ Are the FAAB fields (`bbidTotalBalance`/`bbidBudget`/`faabBudget`, `bbidAvailableBalance`) the correct/current names? We try several — which is canonical? |
| `rules` | — | scoring rules | PPR / TE-premium detection | ❓ Is `rules` the right export for scoring, and are we reading the rule structure correctly (vs `league` settings)? |
| `rosters` | `FRANCHISE` (optional) | `rosters.franchise[].player[]` | player id + `status`/`roster_status` (starter/IR/taxi buckets) | ✅ — but confirm the status codes we bucket on (`INJURED_RESERVE`, `TAXI_SQUAD`, `starter`) are the exact documented values. |
| `leagueStandings` | — | `leagueStandings.franchise[]` | h2hw/l/t, pf, pa | ✅ confirm field names (`h2hw`,`pf`,`pa`) are current. |
| `liveScoring` | — | `liveScoring.franchise[]`; `liveScoring.week`; franchise `players.player[]` | score, playersYetToPlay, projectedScore, gameSecondsRemaining, opp_id | ⚠️ Confirm `opp_id`, `playersYetToPlay`, `projectedScore`, `gameSecondsRemaining` field names + that per-player statuses live under `franchise.players.player[]`. |
| `freeAgents` | — | `freeAgents.leagueUnit.player[]` | player ids (cap 300) | ⚠️ Any filter params (position, count) to shrink this payload? We fetch all and slice client-side. |
| `projectedScores` | `W` (optional) | `projectedScores.playerScore[]` | id, score | ❓ Does this need `W`/`COUNT`/`RULES` params to be accurate? We sometimes omit `W`. |
| `playerScores` | `W`, `PLAYERS` | `playerScores.playerScore[]` | id, score | ❓ Correct params for a single player's week/YTD/avg score? |
| `schedule` | `W` (optional) | `schedule.weeklySchedule[].matchup[].franchise[]` | opponent lookup | ⚠️ Is `weeklySchedule[].matchup[].franchise[]` the right nesting for the current season? |
| `calendar` | — | `calendar.event[]` | waiver lock/unlock windows (text-scanned) | ❓ Is there a structured field for waiver open/close instead of scanning event text? |
| `pendingTrades` | `FRANCHISE` | `pendingTrades.pendingTrade[]` | trade_id, offeredto, will_give_up/will_receive, expiration, comments | ⚠️ Confirm the exact attribute names (we match several spellings: `offeredto`, `will_give_up`, `will_receive`). |
| `transactions` | — | `transactions.transaction[]` | type, timestamp, franchise, transaction payload | ⚠️ Confirm the `transaction` payload format per type (TRADE vs ADD/DROP) — we parse `|`-delimited fields. |
| `draftResults` | — | `draftResults.draftUnit[].draftPick[]` | round/pick/franchise/player, unit=LEAGUE | ⚠️ Multi-unit (division) drafts — do we handle `draftUnit` selection right (we pick unit==='LEAGUE' else [0])? |
| `futureDraftPicks` | `FRANCHISE` (optional) | future picks | pick ownership (FP tokens) | ❓ Confirm the export name/shape for **future** (not current-year) picks. |
| `tradeBait` | — | `tradeBaits.tradeBait[]` | franchise_id, willGiveUp | ⚠️ Note TYPE is `tradeBait` but envelope is `tradeBaits.tradeBait` — confirm. |

### Global reads (no `L`; host = api host)

| TYPE | Params | Reads | Status · Verify |
|---|---|---|---|
| `myleagues` | `FRANCHISE_NAMES=1` | `leagues.league[]` (bootstrap: which leagues + host + franchise) | ✅ confirm `FRANCHISE_NAMES` is the right flag + response shape. |
| `players` | `DETAILS=1` | full player universe (`players.player[]`) | ✅ MFL says the player DB changes once a day — **now cached 24h** (daily tier). Still worth asking if a `SINCE`/incremental variant exists to shrink the cold download. |
| `injuries` | `W` | `injuries.injury[]` | status/details | ✅ confirm current-week semantics. |
| `nflSchedule` | `W` (or none) | `nflSchedule.{week,matchup}[]` | bye/schedule | ⚠️ Confirm with/without `W` behavior. |
| `adp` | `PERIOD=RECENT` | ADP | draft value model | ❓ Are `PERIOD` + other params (FCOUNT, IS_PPR, etc.) set optimally? |
| `topAdds` | — | trending adds | waiver "trend" | ❓ Params (W, COUNT)? Are we getting the window we intend? |
| `topOwns` | — | ownership % | player ownership | ❓ Params/period correct? |

---

## 2. WRITE endpoints (import?TYPE=…) — confirm carefully 🔴

Writes are the highest-risk: a wrong param can fail silently or do the wrong thing to a real league.
(Reminder from our rules: **zero-pad franchise ids to 4 digits**; **always surface `err.mflError`**.)

| TYPE | Params we send | Status · Verify from docs |
|---|---|---|
| `lineup` | starters for the week | 🔴 Confirm exact param name for the starter list + week + whether it replaces or merges. |
| `tradeProposal` | offer (give/get assets, partner, expiration, FAAB `BB_`) | 🔴 Confirm asset token format (players numeric; picks `FP_<owner>_<year>_<round>`; current pick `DP_`; FAAB `BB_<dollars>`), the will-give/receive param names, and franchise-id padding. |
| `tradeResponse` | `TRADE_ID`, `RESPONSE` (accept/reject) | 🔴 Confirm `RESPONSE` allowed values + that `TRADE_ID` is the right identifier from `pendingTrades`. |
| `tradeBait` | give/get lists | 🔴 Confirm set-vs-append semantics and token format. |
| `draftPick` | `PLAYER` (+ franchise) | 🔴 Confirm the make-pick params (does it need round/pick or infer from on-the-clock?). |
| `drop` | `DROP` (player id) | 🔴 Confirm — plain drop to free agency. |
| waiver claim: `blindBidWaiver` / `fcfsWaiver` / `waiverRequest` | `ADD`, `DROP?`, `BBID?` (FAAB) | 🔴 **Highest priority.** Confirm the exact TYPE per system (FAAB vs FCFS vs continuous), the bid param name (`BBID`?), whether ADD/DROP take single ids or lists, and how immediate free-agent adds differ from waiver claims. |

**Open write question:** is there a distinct **free-agent "add"** import (immediate acquisition) separate from
the waiver `*Waiver` types? We currently route immediate adds through the waiver path — confirm that's right.

---

## 3. Auth, rate limits, hosts

| Topic | Our behavior | Verify from docs |
|---|---|---|
| Auth | `login` (user/pass → MFLUSERID cookie); password never stored; cookie encrypted at rest | ✅ Confirm the login export and that cookie auth is the right mechanism for user-scoped read+write. |
| Client identity | Validated User-Agent `dynasty-central`; optional `APIKEY` param supported but unused | ✅ Confirm nothing else (referer, etc.) is required for a validated client. |
| Rate limits | Throttle 8 concurrent / 75 ms stagger (with validated client) + adaptive 429 cooldown / 503 backoff | ✅ **Resolved:** MFL publishes **no fixed ceiling** — registered clients get ~2.5× unregistered limits, and limits drop during games. Approach stays empirical/adaptive; 429s are logged (not retried) so the real limit shows in live signal. |
| Host routing | Per-league `host` from `myleagues`; all pinned to `*.myfantasyleague.com` | ✅ Confirm league-specific host usage is correct (vs always api host). |
| Caching | TTL tiers (static/live/slow); coalesced reads | ❓ Any documented cache/`If-Modified-Since` support to avoid re-fetching unchanged data? |

---

## 4. Prioritized questions for the authenticated docs

Answer these (or paste the relevant doc sections) and we'll turn them into fixes:

1. **Waiver writes** 🔴 — exact TYPE per system + bid param (`BBID`?) + ADD/DROP single-vs-list + free-agent-add path.
2. **Trade writes** 🔴 — proposal/response param names, asset token formats, FAAB in a trade.
3. **Rate limits** — documented request-rate ceiling for a validated client (governs our throttle).
4. **`players` payload** — is there an incremental/smaller variant than `DETAILS=1` (cold-start cost)?
5. **FAAB/waiver settings field names** on the `league` export (we guess among several).
6. **`freeAgents`/`projectedScores`/`topAdds`/`topOwns`** — any filter/period params we should be setting.
7. **`liveScoring` field names** (opp_id, projectedScore, playersYetToPlay, gameSecondsRemaining).

> Once these are answered, each becomes a concrete backend change (a param added, a field renamed, a write
> corrected) — verified by the smoke/live suite, and (for reads) shipped via Render with no app build.
