# Dynasty Central — Roadmap & Backlog

Living list of what's left to build and improve. The milestone history (M1–M4 and
the command-center work) lives in [`README.md`](README.md#roadmap); this file
tracks **remaining** work: functional features, deferred performance/caching items,
known data limitations, and hardening/ops.

Last reviewed: 2026-07-19.

---

## Functional features

Cross-league management is the moat; these deepen it.

- [x] **Cross-league watchlist.** Star a player from his profile (☆ Watch); the
  Players → **Watch** tab lists everyone you track with, per player, his value /
  availability / news and where he stands in every league (rostered / free /
  on another team). Backend: `store/watchlist.js` + `/api/watchlist` roll-up
  reusing the roster + free-agent sets. *(Next: quick add/trade actions straight
  from a watch row, and surfacing "your watched player is now a free agent" on
  Home.)*
- [x] **Portfolio dynasty dashboard + value-at-risk.** `/api/portfolio` +
  PortfolioScreen (reached from Home's "Portfolio · value at risk" row): total
  dynasty value across leagues, value-weighted age, value-by-age curve, and
  value-at-risk — split into hurt starters (can't deploy now) and aging cores
  (past a position-aware decline age), with the biggest at-risk holdings listed
  (tap → profile) and a per-league breakdown. **Redesigned** into a true portfolio
  overview: value-over-time sparkline + movement line (daily snapshots retained per
  account), position allocation, and top holdings (each player's value summed across
  every league you roster him in, with exposure + portfolio share). *(Next:
  expiring-contract risk where MFL exposes it.)*
- [x] **Strength-aware dynasty outlook.** Outlook (Win-now / Ascending / Rebuilding /
  Balanced) now blends **roster strength** — where a team's total value ranks among
  all franchises in its league — with **core age**, instead of age alone. Age-only
  mislabeled two similarly-young teams identically even if one was stacked and the
  other threadbare; strength separates them (young + strongest → Ascending, young +
  weakest → Rebuilding). Live ranks my roster value against every franchise's; demo
  uses a strength fixture. The four buckets are exhaustive (sum to league count) and
  the Portfolio "By league" row shows the strength tag that explains each label.
  *(Next: fold in actual on-field results (standings/points) alongside dynasty value
  once we're reading `leagueStandings`.)*
- [x] **League switcher / mute / pin.** The Leagues screen doubles as a switcher: **pin**
  (★) a league to float it to the top of every cross-league view (Home, Portfolio "By
  league", Waivers, Trades, Watch, On Deck), or **mute** (🔔) a finished/bye team so it
  drops out of Home triage, On Deck, and exposure. Pin and mute are opposite intents, so
  setting one clears the other. Durable per-owner via `store/leaguePrefs`; the leagues
  endpoint returns pinned-first with `pinned`/`muted` flags, `leaguesService.orderedLeagues`
  (`hideMuted`) is the shared read the aggregates route through, and the mute filter is
  applied at each named surface (`getHome`, `ondeck`, `exposure`) so a muted league can't
  leak back in through a sub-service's own league read.
- [x] **Trades are discoverable (the trade hub).** The cross-league Trade hub used
  to be reachable only when an offer happened to be waiting (Home row gated on
  `tradeOffers`); the "Trades" chip was a dead count and proposing was buried under
  a league's roster. Now: a persistent Trades row on Home (opens the hub whether or
  not you have offers), the Trades chip is tappable, and the hub itself lists every
  league under **Start a trade** → opens that league's desk on the **Propose** tab.
- [x] **Centralized trade bait ("On the Block").** Flag players you're shopping in any
  league (⇄ Block toggle on each roster player) and manage them all in one place:
  `/api/tradebait` + OnTheBlockScreen (reached from the Trade hub's **⇄ Block**),
  grouped by league with value / roster slot / your note, stale detection (flags a
  player you've since traded or dropped), and a **Shop ›** jump to that league's trade
  desk on the Propose tab. Adds are ownership-guarded (only players you roster).
  Durable via `store/tradebait`. **Suggested partners:** each bait player lists the
  rivals who'd most want him — thin at his position or an upgrade to their best there,
  contenders breaking ties — from the all-franchise roster data (`roster.leagueFranchises`).
  **MFL sync:** blocking/unblocking a player re-pushes the league's full set to MFL's
  native Trade Bait board (`import TYPE=tradeBait`, `WILL_GIVE_UP`/`IN_EXCHANGE_FOR`),
  best-effort so a sync failure never breaks the local block. **Note editor:** tap a
  block player's note to set an asking price / target in a modal; it saves via the
  idempotent add (updating the note, no duplicate) and re-syncs `IN_EXCHANGE_FOR` to
  MFL. *(The MFL import param names follow the documented convention but need
  verification against a live account — MFL blocks its own API docs to us; tighten
  once confirmed on-device.)*
- [x] **League-by-league trade crafting + needs/surplus + fit suggestions.** "Trade
  for" a player no longer opens a batch-send of N pre-filled offers. Instead it lists
  the leagues where he's a target (auto-opens when there's only one) and each opens
  that league's trade **desk seeded** with the target on the "you get" side and a
  suggested package on "you send". The desk surfaces both teams' positional **needs &
  surplus** (league-relative, from the starting-lineup requirements), and the
  **Suggest** button (and the seed) build a package that's fair by **league-specific
  value** (format-aware: scoring/roster) AND biased to the partner's needs from your
  surplus (`lib/tradefit` + `GET /trades/suggest`). Value updates live as you adjust.
- [x] **Trade construction verdict (both teams, incoming + outgoing).** Every offer carries a
  roster-construction read alongside the value verdict: **caution** ("Sends a WR you're already
  thin at — don't do it") when it deals away a need, **good** ("Fills your WR need from RB depth")
  when it addresses a need from surplus, else **neutral**. Incoming offers show your read; **outgoing
  offers show BOTH teams** (yours + theirs, phrased "likely to bite" / "a tough sell"), and the
  **live builder** shows both sides' construction as you add/remove players. From
  `tradefit.constructionVerdict` (subject-aware) over each team's league-relative needs/surplus.
- [x] **Trade counter-offers + trade-bait-aware suggestions.** Incoming offers now have a
  **Counter** action (on the league desk and the cross-league hub) that seeds the builder
  with a value-balanced counter of the **same construction** — keeps their players, and if
  their offer left you light, asks for one more of theirs (preferring one on **their** MFL
  Trade Bait board, or at your need) to reach fair; sending it declines their original.
  Both the initial "trade for" suggestion and the counter now lean on **both teams' trade
  bait** — your shopped players are preferred in the give, their shopped players in the ask
  (`counterFor` + `tradeBaitByFranchise` reading MFL's `tradeBait` export / demo fixture).
- [~] **Waiver Wizard flexibility + lock awareness.** Done: position-filter chips +
  a deeper candidate pool (pick a different player, filter by position), and it
  now detects leagues where waivers aren't running — **calendar-first** (MFL
  `TYPE=calendar` "Lock/Unlock All Free Agents" events are the authoritative
  transaction-lock signal) with the **draft heuristic as fallback** (draft pending
  → locked), shown on the landing + walked-past in the wizard. **Multi-add per
  league** now done — the wizard can queue several claims in one league (+ Queue
  this & add another) with FAAB budgeting AND roster space validated **across the
  queue** (`previewMulti`/`submitMulti`: each bid fits alone yet the sum can't bust
  the budget; N adds into M open spots need the drops; dup add/drop caught), then
  submits the whole queue at once. *(Calendar parser is best-effort against an
  unverified response shape — text-scans lock/unlock semantics tolerant of
  field-name/format variation; tighten once verified against a real league's
  calendar response.)*
- [x] **Target / Avoid personal player tags (±10% value overlay).** Let the owner tag any
  player **Target** (+10%) or **Avoid** (−10%) to encode personal conviction, so the app's
  value-based decisions lean the way they lean. **MVP-1 shipped:** the token-keyed
  `store/playerTags` (+ `modifier` helper), `GET /api/tags` + `POST /api/players/:id/tag`,
  the profile response carries the current `tag`, and the **player profile has a
  Target/Avoid toggle** (tap again to clear). **MVP-2 shipped (trades):** every trade offer
  (inbox + desk) shows a **"For you"** personal-value net alongside the honest **market**
  net, plus **tag notes** ("They want a Target of yours" / "You'd take on an Avoid" / "You'd
  land a Target" / "Sheds an Avoid"); the live builder preview shows the personal net too;
  the builder's player lists carry each player's tag (`trades.personalAnalyze` / `tagNotes`,
  market value untouched). **MVP-3 shipped (suggestion bias):** `suggestFor`/`suggestGive`
  now prefer shipping **Avoids** and protect **Targets** (soft −2 priority, so a Target is
  used only when it's the only fair option); `counterFor` prefers asking for **your
  Targets** on their roster (and never your Avoids). **MVP-4 shipped (waivers + draft):**
  the waiver board floats a **Target** free agent to the top and sinks an **Avoid** (chosen
  sort still orders within each group), and the draft board highlights **Target** rows /
  dims **Avoids** — both with a `◎`/`⊘` marker. **MVP-5 shipped (rankings + portfolio):** the
  Players → Rankings tab has a **"My values"** sort (market value × your modifier, so Targets
  rise / Avoids fall — displayed value stays honest) and every ranking row shows the `◎`/`⊘`
  badge; Portfolio has a **"Your tags"** card ("⊘ N Avoids on your rosters — shop them" / "◎ N
  Targets you hold — protected in trade suggestions"). **Feature complete** across profile →
  trades → suggestions → waivers → draft → rankings → portfolio; still, as designed, never
  touches lineups/start-sit. Full spec:
  - **Two lenses — the core principle.** Keep the existing enrichment `value` as the
    honest **market value** (it drives fairness and, crucially, the *partner's* perception
    and their needs/surplus — they don't share your tags). Add a **personal value** overlay
    = `market × modifier` (Target ×1.10, Avoid ×0.90). Never fold the modifier into the one
    shared value, or the "fair deal" verdict stops telling the truth and the partner gets
    mis-modeled.
  - **Mechanic.** Multiplicative (a Target stud swings more than a Target scrub, for free),
    applied to the player wherever he lands on **your** side of a deal — symmetric and
    self-correct in all four directions (acquire/send × Target/Avoid). Applies to
    value-based surfaces only.
  - **Data model.** A token-keyed `store/playerTags` (`token → { [playerId]: 'target' |
    'avoid' }`), **global across leagues** (conviction is player-level), mirroring
    `watchlist`/`tradebait`/`leaguePrefs`. A tiny `personalValue(id) = marketValue(id) ×
    mod(tag)` helper the surfaces opt into. Tag toggle lives on the **player profile**
    (`◎ Target` / `⊘ Avoid`) — reachable everywhere now (System 1).
  - **Integration (ranked).** *Core — trades:* your-side value in the builder + inbox
    verdict, showing **both** market and your value; bias `suggestFor`/`counterFor` to put
    **Avoids** in the give and protect **Targets**; inbox flag "they're asking for a Target"
    / "you'd take on an Avoid". *Waivers:* a **Target** who's a free agent floats to the top
    with a star (ties into watchlist alerts + push — "your Target just hit waivers");
    Avoids sink. *Draft board:* Targets highlighted, Avoids dimmed (the opt-in, owner-
    declared personalization — distinct from the rejected *need-adjusted* board, which
    guessed). *On the Block:* offer to add an Avoid to the block; surface "your Avoids —
    shop these". *Rankings/Players:* a tier badge + optional "my values" sort. *Portfolio:*
    "you roster N Avoids across leagues".
  - **Explicitly NOT lineups / start-sit.** Those stay projection-driven — starting a worse
    player because you like him loses points. The modifier has no business there.
  - **Cross-wire** (keep the concepts distinct — tag = value lens, watch = track, block =
    shopping — but link them): tagging Target offers "watch him"; tagging Avoid offers "add
    to block".
  - **Open decisions.** Ship **binary** ±10% but store a numeric modifier so a stronger
    "Cornerstone" (+25%) / "Hard Avoid" (−25%) tier is later config, not a rewrite; show
    **both** values in trades, personalize silently elsewhere.
  - **MVP slice.** Store + profile toggle → trades only (your-value in builder & inbox,
    both values shown, suggestions biased) → waivers/draft highlights → rankings/portfolio
    polish.

## Cross-screen synergy (UX pass — reviewed 2026-07-20)

A full PO/UX pass found the app computes two rich shared objects — a **cross-league
player object** (the profile: where a player stands in every league, format-aware
value per league, value range) and **per-league dynasty intelligence** (needs/surplus,
outlook, strength, value-at-risk) — but each screen renders flat text and dead-ends
instead of routing into them. The work is plumbing that intelligence between screens.
Grouped into four "synergy systems", highest-leverage first:

### System 1 — Every player is a doorway (tap → PlayerProfile)
- [~] **Thread `onOpenPlayer` into every player list.** Mostly done: the shared
  `PlayerRow` (Roster, Waivers board, Trades desk / TradeInbox, On the Block) and the
  Draft room already open the cross-league profile on tap. Scores shows team-vs-team
  totals, not player rows, so there's nothing to link there. **Remaining:** the lineup
  **slot editor / wizard**, where the row IS the slot-selection target — tap-through
  needs a dedicated affordance (a small info tap) to avoid a gesture conflict.
- [x] **Draft room: separate research from drafting.** Done: a pool row taps through to the
  player's profile to scout him; drafting is a separate explicit **Draft** button that routes
  through a confirm Alert (`confirmDraft`), so a single tap can never = an instant/accidental
  pick. The section header spells it out ("tap a name to scout, Draft to pick").

### System 2 — Needs/surplus + outlook should follow you everywhere
- [x] **Make dead-end aggregates tappable.** Portfolio "By league" rows (outlook · core
  age · strength · %risk) now open that league's roster; Home's offseason outlook chips
  (Win-now/Ascending/Rebuilding/Balanced) drill into Portfolio (where each per-league row
  is tappable), and the Waivers chips open the Waivers tab. The **Leagues** switcher rows
  are now enriched with per-league outlook · value · %risk via a background `/api/portfolio`
  fetch that merges in when it lands, so the switcher keeps its instant open (names +
  pin/mute first, dynasty badges a beat later).
- [x] **Draft board ordered by ADP** (chosen over a need-adjusted board — need-weighting
  is owner-dependent, so we went with an objective market order instead). The available
  pool is ordered by MFL's global `adp` export (`lib/adp.js`, memoized, best-effort with a
  tolerant parse), each row shows its ADP, and players without an ADP fall to a
  value-ranked tail so the board is never arbitrary. Demo uses an ADP fixture.
- [x] **Seed On the Block → trade desk.** Each "Best fits" partner is now a tappable chip
  that opens the league's trade desk with the shopped player pre-loaded on the "you send"
  side and that partner selected (new `seed.sendPlayerId` branch in TradesScreen; the
  suggestion already carries the partner `franchiseId`). No more rebuilding the trade by
  hand. *(`Shop ›` at the league level still opens the empty builder — there's no single
  player context there.)*
- [x] **Annotate the inbox "Start a trade" list.** Each league flags "N on the block here"
  (your bait) AND a fit nudge — "You're deep at RB · 2 rivals need it" — derived from the
  league's needs/surplus map (`trades.tradeFitSummary` over the same `tradeData` the desk
  uses; getOverview now reads it for every league, not just offer-leagues). Picking where
  to propose now leads with where a deal is most likely to click.

### System 3 — Signals computed and thrown away
- [x] **Surface watchlist events on Home.** A new **Watchlist** section on Home flags a
  tracked player who just became a **free agent** you could claim, or whom **another owner
  put on the block** (their MFL trade bait), in any of your (non-muted) leagues. Backend
  `watchlist.alerts` + `GET /api/watchlist/alerts` cross the watchlist ids with the
  memoized free-agent sets and the trade-bait board; each row opens that player's profile
  (add/trade from there). Fetched in the background, empty-fast with no watchlist.
- [~] **Expand push beyond draft-clock + trade-offer.** Push now also fires for a **lineup
  that needs attention** before kickoff (from On Deck's `lineup_lock` items, keyed by
  league+kickoff so it's once per week per league) and a **watchlist** player who's newly a
  free agent / on another owner's block. Each channel is an independent pref and is only
  polled when enabled (`buildFor` + `tick` in `notifications.js`). *(Still open: injuries to
  a starter and waiver-run times — the latter has no machine-readable MFL timestamp; a
  waiver-run times — the latter has no machine-readable MFL timestamp.)* A **Settings
  screen** (⚙ on Home) now lets the owner explicitly toggle each push channel (draft
  clock / trade offers / lineup attention / watchlist); choices save immediately and
  persist even before the device registers a push token (`GET`/`POST /api/push/prefs`).
- [x] **Unify the "where does this player stand" computation.** The profile's `crossLeague`
  card, the watchlist `relationIn`, and exposure each rolled their own roster/FA
  classification — with *conflicting* vocabularies (the watchlist called my roster "mine"
  and another team "rostered"; the profile called my roster "rostered" and another team
  "unavailable"). Extracted `lib/standing.js` — one canonical `standing()` returning
  `{ where, mine, bucket }` (starter/bench/ir/taxi/free/other) plus the shared `BUCKETS`
  constant. Each caller now maps that to its own existing labels, so no API changed;
  behavior is identical (all three suites still pass) and there's a `standing-test`
  locking the vocabulary so they can't drift apart again.

### System 4 — In-season chains that stop one link short
- [ ] **Lineup hole → waiver board (filtered by position).** The `initialPosition`
  deep-link already exists (Home/On Deck use it); Lineups/Editor know the empty slot's
  position but never call it.
- [ ] **Scores → LineupEditor for the same league** (close game + benched players who
  can still move); show *which* players are yet-to-play, not just a count.
- [ ] **After a waiver claim, offer to set the lineup** if the add needs a starting slot
  (today it dead-ends back to Waivers).
- [ ] **Draft picks ↔ trade assets.** Draft room/hub never link to the trade desk, and
  the desk can only *send* picks, never *receive* them — a real functional gap for a
  core dynasty currency.

### Per-screen polish (from the same pass)
- [x] **Players lists show no age** — the PlayersScreen row shows age, the **Trending** sort
  shows each player's add/drop momentum (▲ N) in place of value, and ownership is now
  **personal**: "rostered N/M" = how many of *your* leagues roster him (total minus where he's
  a free agent), replacing MFL's site-wide ownership. Backend `annotate` carries
  `leagueCount`/`leagueOwned`/`leagueOwnedPct`.
- [ ] **Waiver claim: add-vs-drop value delta** side by side (the core dynasty claim
  decision); `FaRow` vs `PlayerLine` render the same entity two different ways.
- [~] **Trades: value vs. construction verdicts** — done: a deterministic **bottom line**
  (`trades.bottomLine`, value verdict × construction rating → one take + tone) now renders as a
  colored callout above Accept/Reject on both the inbox and the desk, so "You gain value" next
  to "⚠ hurts your roster" no longer leaves the decision ambiguous. *(Remaining: de-emphasize
  the raw "dynasty value estimate" caption; the inbox still shows one-sided construction where
  the desk shows two.)*
- [x] **Home label collision:** fixed — the "Needs attention" tile now shows the count of
  action **items** (matching the feed it opens on tap) instead of a separate "leagues affected"
  number; the tile is tappable (opens the triage feed) and its player rows use `onOpenPlayer`.
- [ ] **Consolidate duplicated UX:** one primary bulk-lineup path (wizard vs auto-set
  sheet), one shared claim builder (WaiverWizard vs ClaimSheet), one matchup component
  (recomputed in Scores/Lineups/Editor/Wizard with wording drift), shared `PlayerRow`.
- [ ] **Portfolio `strengthLabel` thresholds are re-hardcoded client-side** (drift risk
  from the backend model) — source them from the backend.
- [~] **Roster: rookie picks are inert text** — done: draft picks on the roster are now
  first-class assets (dynasty value each + combined total, sorted soonest-first) and each is
  **tappable to shop it** — opens that league's trade desk on Propose with the pick pre-loaded
  on your side (`seed.sendPickToken`; pick value centralized in `lib/picks.value` so the roster
  and desk always agree). *(Remaining: a positional value breakdown of the roster.)*

## Design & motion

Moving the app from "functional but uninspired" toward a slick, branded product.

- [x] **DC monogram on the crest + first-impression polish.** The "Regent Crest" now
  carries the brand's initials: the crown became a **coronet** (three points = your
  leagues) and a **gold roundel medallion holds a crisp "DC" monogram**, over the gridiron
  hash-marks. Login is the flagship polish pass — a branded `FieldBackdrop` (navy gradient
  + soft gold glow + faint yard-lines), a choreographed entrance (crest springs in,
  wordmark rises, a gold rule wipes out under "Central"), and a tactile `PressableScale`
  button. All with the built-in `Animated` API (no new native deps).
- [~] **Roll the motion primitives across the app.** Started: `PressableScale` on the tab
  bar, and a `Pulse` (new looping breathing component) on the on-the-clock "PICK" pill.
  Still to apply: `PressableScale` on triage/roster/waiver/trade cards, `FieldBackdrop`
  behind the Home/Portfolio headers, pulse on the Scores "live" indicator, and staggered
  section reveals on Home.
- [x] **Bundle a display typeface.** **Oswald** (condensed "broadcast" face) via `expo-font`
  + `@expo-google-fonts/oswald`, wired into `ScreenTitle` and the Login wordmark. Loaded
  defensively (`src/typography.js`): the packages are `require`d in a try/catch and the
  load races a ~2.2s timeout folded into the boot gate, so a missing/slow font can't hang
  the splash or crash — it just falls back to the system face. Numbers stay in the system
  face for tabular alignment. *(Needs `npx expo install` + a rebuild to activate on-device;
  verify the weights render.)*
- [ ] **Regenerate the app icon / splash** from the new DC crest.

## Performance & caching backlog

The big wins are shipped (parallelized per-league fan-outs; cached `listLeagues` /
`franchiseNames`; promise-coalescing MFL read cache; memoized `getRoster` /
free-agent reads; memoized enrichment snapshot, `leagueFormat.format`, player
ranks, news crosswalk, bye map; compiled scoring; slice-before-annotate in the
player hub; **Players-screen gather memoized + light roster read** — the
cross-league "mine/free" gather now uses a franchise-scoped `myRosterLight`
(no all-franchise valuation / strength / picks) instead of the full `getRoster`
build, and is memoized per cookie so switching rank type / refining search /
opening a profile reuses one gather; **player DB persisted to disk** — with a
real `DATA_DIR` (mounted disk) the big MFL `players` export is saved to the
durable store, so a restart rehydrates it from disk instead of re-downloading the
whole NFL universe (`MFL_PERSIST_PLAYERS`, auto-on when `DATA_DIR` is set);
**Waivers landing lightened** — the per-league overview used the full `getRoster`
(all-franchise valuation + strength) and the full free-agent board build
(`projectedScores` fetch + per-player enrichment for ~300 players) just to show a
roster count + FA count + top 3; it now uses `myRosterLight` and a light
`freeAgentSummary` (memoized ids + values, no projections/board build)).
Remaining, in rough priority order:

- [ ] **DraftScreen: virtualize the player pool.** `DraftScreen` renders the
  undrafted pool with `ScrollView` + `.map` (hundreds of rows, re-rendered on a
  15s poll and every filter tap). Convert to `FlatList` with `keyExtractor`,
  header/my-picks in `ListHeaderComponent`. *(Deferred: needs on-device UI
  verification, not just a parse-check.)*
- [x] **Stale-while-revalidate on the overview screens.** Lineups, Waivers, and the
  Players → Rankings tab now paint their last-known data from the on-device cache
  instantly and refetch in the background (`useCachedResource` hook + per-screen
  wiring), so they no longer cold-load with a blank spinner. Always revalidates
  (never skips the fetch), so there's no stale-after-action surprise — the trap
  that sank the earlier time-based Home gate. *(Not applied to Scores — it's live
  and freshness matters. Draft Hub and Trade Inbox could get the same treatment.)*
- [ ] **Seed overlays from Home's already-fetched data.** Home fetches `drafts`,
  `onDeck`, and `news`; the Draft Hub / On Deck / News screens then refetch the
  same endpoints cold. Pass the loaded data as an initial prop (still revalidate).
- [ ] **`React.memo` the long-list rows.** Players rankings, the waiver board, and
  the draft pool re-render every visible row on any parent state change (e.g. a
  poll tick). Wrap `PlayerRow` / `FaRow` / draft rows in `React.memo` and
  stabilize their `onPress`.
- [ ] **Lift Home state above the overlay switch (optional).** `App.js` returns an
  overlay *instead of* the tab view, so opening/closing any overlay unmounts and
  remounts the active tab. The Home freshness gate mitigates the refetch cost;
  keeping the tab mounted under the overlay would remove the remount entirely.
- [ ] **`SlotEditor` picker: memoize filter+sort.** Small (roster-sized), trivial
  `useMemo`.
- [ ] **Enrichment provider in-flight coalescing (minor).** The four external
  providers (FantasyCalc / Sleeper / MFL topOwns / topAdds) cache resolved values,
  not in-flight promises. The snapshot memo already coalesces same-format callers;
  distinct-format concurrent cold callers could still double-fetch a provider.
  Low priority.

## Data limitations (MFL doesn't expose these cleanly)

Tracked so we stay honest rather than fabricating. Revisit if MFL adds fields or we
add another data source.

- [ ] **Real trade-deadline dates.** MFL has no machine-readable trade deadline, so
  On Deck omits it rather than guessing. Could be sourced from league rules text
  if a reliable parse exists, or entered manually per league.
- [ ] **Machine-readable waiver run times.** MFL exposes only a human run-time
  string, so waiver items on On Deck are label-only (sorted after timestamped
  items). Revisit if a structured field appears.
- [ ] **Live projections floor/ceiling.** Floor/median/ceiling bands are a model
  estimate (position volatility around the projection), flagged as estimates in the
  UI — not a real distribution. A better source would replace the heuristic.
- [ ] **Source tradeable picks from MFL's `assets` export.** Current-year (upcoming-draft)
  picks are currently derived from the `draftResults` grid: ownership is authoritative
  (MFL's per-slot `franchise`, correct even after pick trades), but the `DP_<round-1>_<pick-1>`
  trade token is *constructed* by us from MFL's round/pick numbers — the one part that
  needs an on-device check. MFL's `export?TYPE=assets` is purpose-built for "what can this
  franchise trade" and should return players + current/future picks **already tokenized** in
  the exact trade-API format, removing the construction (and covering edge cases like
  conditional picks). Rework to use `assets` as the primary source with the `draftResults`
  derivation as fallback. Blocked on confirming the export's exact shape against a live
  account (MFL blocks their API docs from us), so pair with the live-MFL verification below.

## Hardening & ops

- [ ] **Live-MFL verification against a real account.** The read/write shapes follow
  the public API docs but haven't been exercised end-to-end against a real login.
  Verify: `login`, `myleagues`, `rosters`, `players`, `liveScoring`, `schedule`,
  `projectedScores`, lineup/waiver/trade/drop imports. See
  [`backend/README.md`](backend/README.md#going-live--what-still-needs-verifying).
- [ ] **Push-notification delivery on a real device.** The scheduler + Expo push
  path is built; delivery (on-the-clock, new trade offers) needs a physical device
  with a real Expo push token to confirm end-to-end.
- [ ] **Keep the Render instance warm.** Free-tier spin-down adds a ~30–60s cold
  start on first open after idle — the most likely remaining "the app feels slow"
  cause. Options: a paid always-on instance, or a small cron ping to `/api/health`
  every few minutes.
- [ ] **Play Store packaging.** Build + submit the Android app (EAS), store listing,
  and release channel.
