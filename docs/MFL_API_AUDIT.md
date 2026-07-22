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
| `players` | `DETAILS=1` | full player universe (`players.player[]`) | ⚠️ `DETAILS=1` is a big payload; is there `SINCE`/incremental or a smaller variant? We download the whole DB per backend process. |
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
| Rate limits | Throttle 8 concurrent / 75 ms stagger (with validated client) + 429/503 backoff | ❓ **What are the documented request-rate limits for a validated developer client?** This sets whether 8/75 is safe or we can go further. |
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
