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

**FantasyCalc Terms of Use compliance.** We lean on FantasyCalc for player *and* draft-pick
dynasty values, so we honor their ToU: (a) **non-commercial** use only (this is a solo, unpaid
app — a commercial release would need their written permission); (b) **attribution** — a tappable
"FantasyCalc.com" credit sits in close proximity to the values on every value-bearing screen
(rankings, player profile, portfolio, trades, pick capital) via `components/ValueCredit.js`, plus a
persistent **Data & credits** row in Settings and the Help "Where values come from" topic; (c)
**cache ~once/day** — the FantasyCalc snapshot uses a dedicated 24h TTL (`FC_TTL_MS` in
`lib/enrichment.js`), longer than the 6h TTL the other providers share, to match their
"ideally retrieve once per day" guidance; (d) we never redistribute bulk FantasyCalc data — only
per-player/-pick values rendered inside the app.

---

## 1. Player identity & attributes

| Datum | Canonical source | Site | Notes |
|---|---|---|---|
| Name / position / team | **MFL `players` DB** (`mapLivePlayer`) | `lib/players.js:64`; resolve `players.resolve` | The MFL id space; everything crosswalks *to* this. FantasyCalc `position` is used only as an internal value-multiplier hint (`enrichment.js:276`), never displayed. Miss → stub `Player <id>`. |
| Dynasty **value** (0–100) | **FantasyCalc** via the enrichment snapshot `enr.value()` | `lib/enrichment.js:288`; snapshot `:329` | **Format-aware** — value depends on the league format passed to `snapshot(fmt)`. Single function, but see [Q3](#q3--value-is-format-dependent-across-screens). |
| Overall **rank** | FantasyCalc `overallRank` → `enr.rank()` | `lib/enrichment.js:293` | |
| Player **age** | **FantasyCalc** `maybeAge` → `enr.age()` (everywhere, incl. the profile) | `lib/enrichment.js:289`; `playerhub.js:520` | Resolved ([Q1](#q1--player-age--resolved-fantasycalc)): the profile header no longer uses `playerProfile.age`. |
| **Ownership %** | MFL `topOwns` → `enr.ownership()` | `lib/enrichment.js:291` | Single source (FantasyCalc has no ownership field). |
| **Trend** (48h add heat) | **Blend**: Sleeper trending adds **+** MFL `topAdds` (summed) → `enr.trend()` | `lib/enrichment.js:279-285,290` | Intentional additive blend; mixes two add-count units into one number. |
| **ADP** | **MFL `adp` export** (board order AND profile bio) | `lib/adp.js:43`; `draft.js:245`; `playerhub.js` | Resolved ([Q2](#q2--adp--resolved-adp-export)): the profile bio now reads the `adp` export, not `playerProfile.adp`. |
| **News** + severity | ESPN news feed | `lib/news.js:97`; crosswalk `:82-93` | Player match is **by name** over the DB index; namesake collisions are skipped, not guessed (`news.js:109`). Severity is regex-derived from the headline. |
| **Headshot** | Sleeper id via FantasyCalc crosswalk | `services/playerhub.js:527`; `lib/enrichment.js:133` | |
| Bio (DOB/height/weight) | MFL `playerProfile` | `lib/mflRepo.js:234-246`; `playerhub.js:484` | Global export; fetched only on the single-player profile screen. |

---

## 2. League & roster data

| Datum | Canonical source | Site | Notes |
|---|---|---|---|
| My league list | MFL `myleagues` | `services/leagues.js:13-23,56` | The only source of `league.host`, `franchiseId` (my franchise), `franchiseName`. Per-cookie, static 1h. |
| Franchise **names** / directory | **MFL `league`** `franchises.franchise[].name` → `franchiseNames` (HTML-stripped) — canonical for all franchises incl. mine | `lib/mflRepo.js:52`; `services/leagues.js:66` | Resolved ([Q4](#q4--my-franchise-name--resolved-league-directory)): where the directory is loaded it wins; `myleagues.franchise_name` is the fallback only when it isn't (cheap paths — my own roster). |
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

### Q1 — Player age — RESOLVED (FantasyCalc)
FantasyCalc `enr.age()` is canonical **everywhere**, including the profile header (which no longer uses
`playerProfile.age`). One age per player across all screens. ✅ `playerhub.js:520`.

### Q2 — ADP — RESOLVED (adp export)
The MFL `adp` export is canonical **everywhere** — the profile bio now reads it (via `adpLib.adpMap`)
instead of `playerProfile.adp`, so a player's profile ADP and his draft-board position agree. ✅

### Q3 — Value is format-dependent across screens — RESOLVED (value lens)
**Decision (owner):** on sortable/filterable list screens, add a value-lens toggle (1QB/SF) where it
makes sense; on the player profile, show **both** values; **tradebait** prices each block by that
league's own format (not the default).
**Implemented:**
- The lens keyword ('1qb' | 'sf') → snapshot format lives once in `leagueformat.lensFormat` (only
  `numQbs` varies; PPR stays the dynasty-norm full PPR). Shared so every global list prices identically.
- **List screens:** the Players screen's existing SF↔1QB toggle now also drives the **Free Agents** and
  **Watch** tabs. `GET /api/waivers/best-available` and `GET /api/watchlist` accept `?format=1qb|sf`
  (`getBestAvailable({format})`, `getWatchlist({format})`); the mobile ValueLens state is wired into both
  loaders (incl. the device-origin best-available path). Rankings/search were already lens-driven.
- **Player profile:** returns `values: { '1qb', sf }` alongside the neutral `value`; the profile header
  renders both side by side (there's no single league to key on). ✅ `playerhub.js` profile.
- **Tradebait:** `getBlock`/`getMarket` now price **each league's** bait through that league's own format
  (`snapshot(await leagueFormat.format(cookie, league))`), so a superflex QB you're shopping shows what
  that league would pay. ✅ `tradebait.js`.
- **Exposure ("My Players")** already prices per-league-format, so it was left as-is.
Remaining by design: a **global** screen with no league to key on (playerhub list/search) still defaults
to the neutral 1QB/PPR market unless the lens toggle is set — now a *documented, user-selectable* default
rather than a silent one.

### Q4 — My franchise name — RESOLVED (league directory)
The `league` franchise directory is canonical for all franchise names including mine. Where it's already
loaded (dashboard live matchup, getTeams, getStandings) it wins; `myleagues.franchise_name` is a fallback
only on cheap paths that don't load the directory (my own roster/lineup), where it refreshes at login.
✅ `dashboard.js:45`. Fully canonicalizing those remaining cheap paths would add a per-league directory
read there — left as the deliberate cost trade-off.

### Q5 — FAAB dormant second source — RESOLVED (guarded)
Canonical FAAB budget = `league.bbidAvailableBalance` (60s fresh read). `assets.blindBiddingDollars`
(`mflRepo.normFranchiseAssets.faab`) is on the 5m shared TTL and is now explicitly commented **do not
use for budget math**, so it can't silently become a second source. ✅ `mflRepo.js:209`.

### Q6 — Append-only draft overlay — OPEN (code-health)
The `draft` store records optimistic just-made picks and **never prunes** reconciled ones; it relies
on fill-empty-slot + dedup-by-playerId to avoid conflicting with confirmed `draftResults`. Safe today,
but the store grows unbounded per (account, league). Recommendation: prune entries once `draftResults`
confirms them. (Not a source conflict; deferred.)

### Q7 — Consolidation / code-health
- **Roster slot:** ✅ FIXED — `mflRead.rosterSlot` now uses exact-token matching (short code `TS` →
  taxi), matching `rosterStatus.rosterSlot`; pinned by `mfl-read-sync-test.js`.
- **`futureDraftPicks`/`adp` cache tier:** ✅ FIXED — both moved to the SHARED cross-user cache (they're
  league/account-invariant), `mfl.js` `LEAGUE_GLOBAL_TYPES`.
- **Current week** in `dashboard.liveMatchup`: reads `liveScoring.week` — kept, since the live scores
  belong to *that* week (self-consistent for the live matchup); documented as intentional, not a bug.
- **Pick-token grammar** encoded in 3 places (`parsePickToken`, `labelForToken`, `draft.js:548`) and
  **won-waiver bid parsing** not shared with `parseTransactions`: OPEN — refactors deferred (each is a
  genuine second implementation kept equivalent by tests; consolidating risks more than it fixes today).

### Q8 — Documented-as-is limitations
Not bugs, but worth confirming the app should keep behaving this way:
- **Injury signal:** MFL `injuries` is authoritative for availability; ESPN news `severity` is a
  parallel, unreconciled display narrative (they can disagree).
- **News→player** matching is by name; namesakes (two "Mike Williams") are silently dropped.
- **SoS/opponent difficulty** is unwired (`null`).

### Q9 — Personal data at rest — RESOLVED (encrypted server-side, option 1)
Decision: keep personal data server-side (account-durable, survives reinstall, still usable by
server-side computation like the tag→value overlay) but **encrypt it at rest**. Implemented in
`store/persist.js`: with `SESSION_SECRET` set, every personal namespace (tags, watchlist, value/
portfolio history, trophies, pins, deadlines, push, per-account activity mirrors) is AES-256-GCM
encrypted in `state.json` as a `{ __enc }` envelope (domain-salted via `lib/secretBox`, shared with the
session crypto). The public MFL player-DB cache, the self-encrypted `sessions` namespace, and `meta` id
counters stay plaintext. In-memory state is unchanged, so no store needed touching. Round-trip + at-rest
assertions in `persist-encryption-test.js`. ✅ (Logout still only destroys the session — retention is
intentional; the data is now encrypted rather than plaintext.)
