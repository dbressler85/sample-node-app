# Data Sources — Canonical Source of Truth

The single reference for **where every piece of information the app uses authoritatively comes
from**. For each datum: the canonical source, the read/compute site (`file:line`), and — where the
same datum is available from more than one place — which source wins and why.

> How to read this: **Canonical** = the source the app treats as authoritative. **Also present** =
> another place the same datum exists (parsed but not used, a fallback, or a second read). Anything
> genuinely unresolved is collected in [§12 Open questions](#12-open-questions--ambiguities) and is
> being discussed with the owner before it's settled.

Providers: **MFL** (MyFantasyLeague — the league system of record), **FantasyCalc** (dynasty
values + ages), **Sleeper** (trending adds + headshots), **ESPN** (news), **app stores**
(`state.json`, the app's own data), and **computed** (values the app derives, not reads).

---

## 1. Player identity & attributes

| Datum | Canonical source | Site | Notes |
|---|---|---|---|
| Name / position / team | **MFL `players` DB** (`mapLivePlayer`) | `lib/players.js:64`; resolve `players.resolve` | The MFL id space; everything crosswalks *to* this. FantasyCalc `position` is used only as an internal value-multiplier hint (`enrichment.js:276`), never displayed. Miss → stub `Player <id>`. |
| Dynasty **value** (0–100) | **FantasyCalc** via the enrichment snapshot `enr.value()` | `lib/enrichment.js:288`; snapshot `:329` | **Format-aware** — value depends on the league format passed to `snapshot(fmt)`. Single function, but see [Q3](#q3--value-is-format-dependent-across-screens). |
| Overall **rank** | FantasyCalc `overallRank` → `enr.rank()` | `lib/enrichment.js:293` | |
| Player **age** | see [Q1](#q1--player-age-has-two-sources) | — | **Two sources**: FantasyCalc `maybeAge` (`enr.age()`, all lists) vs MFL `playerProfile.age` (profile header). |
| **Ownership %** | MFL `topOwns` → `enr.ownership()` | `lib/enrichment.js:291` | Single source (FantasyCalc has no ownership field). |
| **Trend** (48h add heat) | **Blend**: Sleeper trending adds **+** MFL `topAdds` (summed) → `enr.trend()` | `lib/enrichment.js:279-285,290` | Intentional additive blend; mixes two add-count units into one number. |
| **ADP** | see [Q2](#q2--adp-has-two-sources) | — | **Two sources**: MFL `adp` export (board order) vs MFL `playerProfile.adp` (profile bio). |
| **News** + severity | ESPN news feed | `lib/news.js:97`; crosswalk `:82-93` | Player match is **by name** over the DB index; namesake collisions are skipped, not guessed (`news.js:109`). Severity is regex-derived from the headline. |
| **Headshot** | Sleeper id via FantasyCalc crosswalk | `services/playerhub.js:527`; `lib/enrichment.js:133` | |
| Bio (DOB/height/weight) | MFL `playerProfile` | `lib/mflRepo.js:234-246`; `playerhub.js:484` | Global export; fetched only on the single-player profile screen. |

---

## 2. League & roster data

| Datum | Canonical source | Site | Notes |
|---|---|---|---|
| My league list | MFL `myleagues` | `services/leagues.js:13-23,56` | The only source of `league.host`, `franchiseId` (my franchise), `franchiseName`. Per-cookie, static 1h. |
| Franchise **names** / directory | **MFL `league`** `franchises.franchise[].name` → `franchiseNames` (HTML-stripped) | `lib/mflRepo.js:52`; `services/leagues.js:66` | Consumers fall back to `Team <id>`. But **my** name also comes from `myleagues.franchise_name` — see [Q4](#q4--my-franchise-name-has-two-authorities). |
| Rosters (players + slot status) | MFL `rosters` `player[].{id,status}` | `lib/mflRead.reads.rosters`; `services/roster.js:104` | Read all-franchise (strength) or `FRANCHISE=me` (light) — two cache entries for overlapping data. Slot vocab → §8. |
| Standings / records / PF·PA | MFL `leagueStandings` | `services/league.js:64`; `mflRead.js:288` | Also the **playoff-seed order** (seed = position in standings order, `playoffs.js:195`). |
| Lineup requirements (starters spec) | MFL `league` `starters.position[]` | `lib/leagueformat.js:43` | |
| Scoring format (PPR / TE-premium) | MFL `rules` | `lib/leagueformat.js:128` | Feeds the value snapshot's format. |
| Playoff team count | MFL `league` `playoffTeams` | `services/league.js:36` | |
| Playoff bracket | MFL `playoffBrackets` (+ `schedule` reconstruction) | `services/playoffs.js:192` | |
| Fantasy matchups (schedule) | MFL `schedule` `weeklySchedule[]` | `lib/mflRepo.js:94` | |
| Live in-game scores | MFL `liveScoring` | `services/scoreboard.js:73` | In-game projected final = `liveScoring.projectedScore` (vs pre-game `projectedScores` — see §8). |

---

## 3. Transactions, waivers, trades

| Datum | Canonical source | Site | Notes |
|---|---|---|---|
| Activity **feed** | MFL `transactions` (`parseTransactions`) | `lib/mflRead.js:332`; `services/league.js:201` | Single-sourced parser. |
| Won-waiver **results** (+ FAAB bid) | MFL `transactions` (`TRANS_TYPE=BBID_WAIVER,WAIVER`) | `services/waivers.js:558-604` | Re-parses the SAME payload, reading the bid from the middle segment — logic **not shared** with `parseTransactions` ([Q7](#q7--consolidation--code-health-not-blocking)). |
| My pending waiver claims + waiver **round** | MFL `pendingWaivers` | `lib/mflRepo.js:152`; `services/waivers.js:541` | Per-cookie. The app's local `waivers` store is an optimistic mirror; **MFL wins** via `reconciledPending` (`waivers.js:646`). |
| **FAAB balance** (budget remaining) | **MFL `league` `bbidAvailableBalance`** (60s fresh read) | `services/waivers.js:94,104` | `assets.blindBiddingDollars` also carries FAAB but is **parsed-and-dropped** — see [Q5](#q5--faab-has-a-dormant-second-source). |
| Waiver settings (type/min/increment/roster size) | MFL `league` | `services/waivers.js:101-142` | |
| Add-eligibility (one league) | MFL `playerRosterStatus` | `lib/mflRepo.js:121`; `waivers.js:736` | Per-cookie. |
| Pending trade offers | MFL `pendingTrades` | `services/trades.js:223` | Per-cookie. Local `trades` store mirrors it (MFL wins in live). |
| Trade block ("on the block") | MFL `tradeBait` | `services/tradebait.js:72` | Local `tradebait` store is an optimistic mirror; **MFL wins** in live (writes go to MFL first, `tradebait.js:84`). |

---

## 4. Draft & picks

| Datum | Canonical source | Site | Notes |
|---|---|---|---|
| Draft grid / status / clock | MFL `draftResults` (+ `calendar` for start) | `services/draft.js:107` | Live 12s. |
| Draft **start time** | **MFL `calendar` `DRAFT_START`** (wins); `draftResults.startTime` fallback | `services/draft.js:159-165` | A real (non-keeper) made pick overrides both for in-progress status. |
| Pick **ownership** (players + FAAB + picks) | **MFL `assets`** (authoritative, post-trade) | `lib/picks.js:151`; `mflRepo.js:219` | **Fallback** when `assets` empty: compose `draftResults` (current-year `DP_`) + `futureDraftPicks` (future `FP_`). Decision at `draft.js:594`, `trades.js:544`. |
| Pick **value** | Computed `picks.value(label)` | `lib/picks.js:33` | Single model; §8. |
| My draft shortlist | MFL `myDraftList` (authoritative); `draftList` store is a mirror | `services/draft.js:656`; `store/draftList.js` | |
| ADP (board order) | MFL `adp` export (keeper+rookie flavor) | `lib/adp.js:43`; `draft.js:245` | vs `playerProfile.adp` on the profile — [Q2](#q2--adp-has-two-sources). |
| Waiver-run / FA-lock windows | MFL `calendar` events | `services/waivers.js:990,1017`; `trades.js:1170` | Three separate scanners over one export (run type / lock text / trade deadline). |

---

## 5. NFL context

| Datum | Canonical source | Site | Notes |
|---|---|---|---|
| Current NFL **week** | `nfl.currentWeek` (MFL `nflSchedule.week` gated by kickoff-proximity; `MFL_WEEK` override) | `lib/nfl.js:40` | `dashboard.liveMatchup` reads `liveScoring.week` instead — [Q7](#q7--consolidation--code-health-not-blocking). |
| **Season** | `config.season` (`MFL_SEASON` env or current UTC year) | `config.js:21` | Single source. |
| **Byes** | Derived: DB team codes ∉ that week's `nflSchedule` matchups | `lib/nfl.js:125` | Depends on both schedule + DB team codes. |
| **Injuries** / game status | MFL `injuries` `injury[].{id,status}` | `lib/nfl.js:157` | Authoritative for availability. ESPN news severity is a parallel display-only narrative (unreconciled — [Q8](#q8--documented-as-is-limitations)). |
| Next kickoff (lineup lock) | MFL `nflSchedule` `matchup.kickoff` | `lib/nfl.js:174` | |
| Strength-of-schedule / opp difficulty | **none wired** — `difficulty: null` hardcoded | `lib/nfl.js:208` | Noted as a gap, not a source. |

---

## 6. App-owned data (stores in `state.json`)

Persisted to one JSON file under `DATA_DIR` (debounced + atomic; degrades to in-memory if read-only,
`store/persist.js`). **Personal stores are keyed by the stable MFL account (`req.account` =
`acct:<username>`), not the bearer token** — despite older "session token" comments (`middleware/auth.js:19`).

**App is the sole canonical source (no MFL equivalent):**

| Store | Holds | Key |
|---|---|---|
| `playerValueHistory` | per-player daily value series (60 pts) | account |
| `portfolioHistory` | total-portfolio daily series (180 pts) | account |
| `playerTags` | Target/Avoid tags | account |
| `watchlist` | tracked player ids | account |
| `leaguePrefs` | pinned leagues | account |
| `trophies` | championship case (`source: manual\|auto`) | account |
| `tradeDeadlines` | manual per-league deadline (MFL has no field) | account+league |
| `push` | Expo push token + prefs + dedup | account |

**Mirror / overlay / snapshot stores that overlap MFL data** (MFL wins in live; store is the source only in demo):

| Store | Mirrors | Reconciliation |
|---|---|---|
| `trades` | `pendingTrades` | service layer; MFL wins live |
| `tradebait` | `tradeBait` | writes to MFL first, local re-synced |
| `waivers` | `pendingWaivers` | `reconciledPending` — MFL rows win, local fills gaps |
| `waiverBids` | `pendingWaivers` (diff) | detects *lost* bids MFL never logs |
| `draft` | `draftResults` | fills empty slots only; **append-only, never pruned** ([Q6](#q6--append-only-draft-overlay)) |
| `lineups` | roster starters | demo source; live short-lived hint |
| `rosterMoves` | roster IR/taxi/drop | **demo-only**; live writes straight to MFL |
| `drops` | a dropped player | **demo-only** |
| `draftList` | `myDraftList` | soft mirror (advisory) |
| `players` (DB) | MFL player universe | cache of MFL, not app-owned |

---

## 7. Credential & session

- **MFL session cookie (`MFL_USER_ID`)** is the sole canonical credential, obtained once at login
  (`lib/mfl.js:529`) and stored in the `sessions` store keyed by a random bearer token. Encrypted at
  rest (AES-256-GCM) **only when `SESSION_SECRET` is set**; otherwise memory-only (`store/sessions.js:28`).
- **The MFL password is never stored** — it flows request body → MFL → discarded; only `{cookie, username}`
  are persisted (`routes/auth.js:31`). Confirmed: no password at rest anywhere.
- Logout destroys the session only; personal stores persist (account-keyed) — see [Q9](#q9--personal-data-retention-on-logout).

---

## 8. Computed / derived values (single canonical unless noted)

| Datum | Canonical function | Notes |
|---|---|---|
| `$t`/num/**franchise-id pad** primitives | `lib/mfl.js:145,153,165` | Mirrored to `lib/mflRead.js`, parity-guarded by `mfl-read-sync-test.js`. |
| **Roster slot** (`ir/taxi/starter/active`) | `lib/rosterStatus.rosterSlot:19` (exact tokens) | **Divergence**: `mflRead.rosterSlot` uses substring matching → mislabels `TS` — see [Q7](#q7--consolidation--code-health-not-blocking). |
| Bucket set (starters/bench/ir/taxi) | `lib/standing.BUCKETS:17` | Shared by exposure + profile. |
| **Availability / startable** | `lib/availability.resolve:21` | Single source. |
| **Player value / age / trend / ownership** | `lib/enrichment.js:286-294` (`enr.*`) | One snapshot, read-only everywhere (34 files). |
| Outlook / strength / coreAge / rosterValue | `services/roster.js:51,75,88` | Shared 0.55/0.45 thresholds; `dynasty-outlook-test.js`. |
| **Pick value** | `lib/picks.value:33` | Single model. |
| Pick **token grammar** (`FP_`/`DP_`) | `lib/mflRepo.parsePickToken:189` (parse) | Grammar re-encoded in `picks.labelForToken:63`, `picks.value:37`, `draft.js:548` — [Q7](#q7--consolidation--code-health-not-blocking). |
| Projections (pre-game) | MFL `projectedScores` (live); `scoring.projectPoints:86` (demo) | In-game uses `liveScoring.projectedScore`. |
| Optimizer / floor-median-ceiling band | `lib/optimizer.js:31`; `scoring.band:128` | Single. |
| Format label | `lib/leagueformat.label:250` | Parallel `scoring.describe:139` (different string, different purpose). |
| Exposure % | `services/exposure.js:87` | Byte-mirrored on device (`mflRead.assembleExposure:435`). |
| **Trade math** (verdict + construction rating) | `lib/tradeMath.js` | Byte-mirrored to `mobile/src/tradeMath.js`, drift-guarded. |

---

## 9. Device-origin mirrors (canonical-on-backend)

`lib/mflRead.js` and `lib/tradeMath.js` are generated into `mobile/src/` by sync scripts and
**cannot drift without failing CI** (`mfl-read-sync-test.js`, `trade-math-sync-test.js` assert
byte-parity). The MFL read **descriptors + parse** are single-sourced (backend `mflRepo` reuses
`mflRead.reads.*.parse`). The device **assemble** functions (`assembleTeams/Standings/Transactions/
Exposure`) are device-side re-implementations of backend service logic — kept equivalent by the
device-parity tests, but they are a real second implementation to keep in step.

---

## 10. Cache tiers (MFL reads)

Applied in `lib/mfl.js`; TTLs in `config.js`. **SHARED** = cross-user (cookie dropped from the cache
key, one fetch serves all league members); **PRIVATE** = per-cookie.

| Tier | TTL | Types |
|---|---|---|
| DAILY | 24h | `players`, `nflSchedule`, `league`, `rules` |
| STATIC | 1h | `myleagues` (private), `calendar` |
| SLOW | 30m | `projectedScores`, `playerScores` |
| LIVE | 12s | `liveScoring`, `draftResults`, `pendingTrades` (private) |
| DEFAULT | 5m | `rosters`, `freeAgents`, `assets`, `transactions`, `leagueStandings`, `schedule`, `injuries`, `tradeBait`, `playerProfile`, `topOwns`, `topAdds`, … |
| FRESH | 60s | `league` via `maxAge` (the FAAB read only) |

PRIVATE: `myleagues`, `pendingWaivers`, `pendingTrades`, `myDraftList`, `playerRosterStatus`, and —
inconsistently — `futureDraftPicks`, `adp` ([Q7](#q7--consolidation--code-health-not-blocking)).

---

## 11. Cross-user shared-cache note (device-origin interplay)

Reads migrated to the device (rosters/standings/transactions/freeAgents/assets/futureDraftPicks/
draftResults/calendar — see `docs/DEVICE_ORIGIN_MFL.md`) give up the backend's SHARED cross-user cache
per read; the mobile app re-coalesces them in its own read cache (`mobile/src/deviceReadCache.js`,
TTLs matched to the tiers above). Single-league detail reads and the cheap/cached reads inside the
device paths (settings/calendar/projections/matchup/pending) remain backend.

---

## 12. Open questions / ambiguities

The cases where a datum has **more than one plausible source** and the intended canonical is not
self-evident. These are under discussion with the owner; this section records the current behavior +
the pending decision.

### Q1 — Player age has two sources
Profile header shows MFL `playerProfile.age` (whole number, `playerhub.js:520`); **every list/table**
shows FantasyCalc `maybeAge` (rounded to 0.1, `enr.age()`). Same player can display two ages.
**Decision needed:** one canonical age source, or accept the profile/list split.

### Q2 — ADP has two sources
Draft board orders by the MFL `adp` export (keeper+rookie flavor, `draft.js:245`); the player-profile
bio shows `playerProfile.adp` (MFL's default flavor). Different periods/scales, never reconciled.
**Decision needed:** unify to one flavor, or keep board vs profile separate.

### Q3 — Value is format-dependent across screens
`enr.value()` is format-aware. League screens price against the league's format; **global** screens
with no single league (playerhub list/search, tradebait, exposure-with-no-primary-league) price
against a **default 1QB/PPR** format. So a superflex QB's value differs between his league's roster
screen and the global playerhub. By design (no league to key on), but a visible cross-screen
inconsistency. **Decision needed:** pick a documented default (1QB vs SF vs a user-selectable lens).

### Q4 — My franchise name has two authorities
My team name comes from `myleagues.franchise_name` (cached at login) on some surfaces and from the
`league` franchise directory on others; they disagree if the team was renamed after login.
**Decision needed:** which is canonical for my own franchise name.

### Q5 — FAAB has a dormant second source
Canonical FAAB budget = `league.bbidAvailableBalance` (60s fresh read). `assets.blindBiddingDollars`
is also parsed into `mflRepo.normFranchiseAssets` as `faab` but **currently unused**. If a future
caller reads it, it would be on the 5m shared TTL and could disagree with the waiver budget.
**Recommendation:** keep `league` canonical; add a guard/comment so `assets.faab` is never used for
budget math. (Low doubt — flagging so the decision is explicit.)

### Q6 — Append-only draft overlay
The `draft` store records optimistic just-made picks and **never prunes** reconciled ones; it relies
on fill-empty-slot + dedup-by-playerId to avoid conflicting with confirmed `draftResults`. Safe today,
but the store grows unbounded per (account, league) and has no active reconciliation delete.
**Recommendation:** prune entries once `draftResults` confirms them. (Code-health, not a source
conflict.)

### Q7 — Consolidation / code-health (not blocking)
Same datum computed by more than one rule; canonical is clear, but the copies risk drift:
- **Roster slot:** `mflRead.rosterSlot` uses substring matching and returns `active` for the short
  code `TS` where the backend (`rosterStatus.rosterSlot`) returns `taxi`. Latent bug (the `rosters`
  export uses long forms, so it rarely fires). **Recommend fixing** to exact-token matching.
- **Pick-token grammar** encoded in 3 places (`parsePickToken`, `labelForToken`, `draft.js:548`).
- **Won-waiver bid parsing** not shared with `parseTransactions`.
- **Current week** read from `liveScoring.week` in `dashboard.liveMatchup` instead of `nfl.currentWeek`.
- **`futureDraftPicks`/`adp` cache tier** is private though the data is league/account-invariant.

### Q8 — Documented-as-is limitations
Not bugs, but worth confirming the app should keep behaving this way:
- **Injury signal:** MFL `injuries` is authoritative for availability; ESPN news `severity` is a
  parallel, unreconciled display narrative (they can disagree).
- **News→player** matching is by name; namesakes (two "Mike Williams") are silently dropped.
- **SoS/opponent difficulty** is unwired (`null`).

### Q9 — Personal data retention on logout
Logout destroys only the session; personal stores (tags, watchlist, history, trophies, …) persist on
server disk **keyed by MFL account**, unencrypted (only sessions are encrypted at rest). Intentional
(durable across re-login), but a privacy posture decision. **Decision needed:** keep account-durable,
or wipe personal data on logout.
