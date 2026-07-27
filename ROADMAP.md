# Dynasty Central — Roadmap & Backlog

Living list of what's left to build and improve. The milestone history (M1–M4 and
the command-center work) lives in [`README.md`](README.md#roadmap); this file
tracks **remaining** work: functional features, deferred performance/caching items,
known data limitations, and hardening/ops.

Last reviewed: 2026-07-27.

**Since the 2026-07-19 review** (all shipped, mobile changes staged for the next EAS build):
- **Design system + full motion/neon system** — `docs/DESIGN_SYSTEM.md` (color law, glow recipe,
  scales), `docs/MOTION_AND_NEON_ROADMAP.md`, and **Phases 0–5 built**: token scales + `glow()` +
  Oswald + `useReducedMotion`; Traversal (overlay lift, tab slide, screen push); consistency sweep;
  the **neon signature** (`NeonSign` flicker engine, emoji → neon signs, `NeonSparks` celebration);
  and the **Threshold ceremony** (`NeonCrest` — the two-tone neon crest — igniting on login, the
  logout mirror, and the unlit crest as the ambient app-background watermark) + **Texture**
  (`useActFlash` acted-on-row flash on top of the existing press/skeleton/roll-up primitives).
- **Neon app icon** — icon / adaptive / splash / favicon re-rendered from the lit neon crest.
- **Watchlist accent = Acid Yellow `#E4F24A`**; active Target/Avoid/Watch now light with the glow recipe.
- **Data-honesty pass** — a shared `PartialNote` ("showing N of M leagues — the rest didn't load")
  across rankings / portfolio / player profile / exposure, backed by loaded-vs-total flags and
  retry-hardened cross-league fan-outs, so a throttled partial load can never present as complete.
- **Device-origin reads** shipped behind flags (see the speed note under Performance).

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
- [x] **Lineup hole → waiver board (filtered by position).** Done: the Lineup editor's
  empty-slot banner deep-links to the waiver board filtered to the hole's eligible position
  (`onOpenWaivers({leagueId, position})`; FLEX → all positions).
- [x] **Scores → LineupEditor for the same league.** Done: tapping a matchup opens that
  league's lineup editor, and each card now lists **which** of your players are still to play
  ("Still to play  Chase (WR), Gibbs (RB)…") — resolved from `me.yetToPlayers` — not just the
  count. *(Live per-player parse from `liveScoring` is best-effort pending on-device verify.)*
- [x] **After a waiver claim, offer to set the lineup.** Done: an immediate free-agent add
  prompts "Added — Set lineup" (ClaimSheet) that opens the editor instead of dead-ending. (A
  future waiver claim that processes overnight correctly doesn't prompt.)
- [~] **Draft picks ↔ trade assets.** Done: the trade desk can now **receive** picks (each
  partner's current-year + future picks are selectable on the "you get" side) and pick tokens
  are first-class on the roster (tap → shop). The Draft room links to the trade desk
  (`onOpenTrades`). *(Remaining: a direct link from the Draft **Hub** into a specific trade.)*

### Per-screen polish (from the same pass)
- [x] **Players lists show no age** — the PlayersScreen row shows age, the **Trending** sort
  shows each player's add/drop momentum (▲ N) in place of value, and ownership is now
  **personal**: "rostered N/M" = how many of *your* leagues roster him (total minus where he's
  a free agent), replacing MFL's site-wide ownership. Backend `annotate` carries
  `leagueCount`/`leagueOwned`/`leagueOwnedPct`.
- [x] **Waiver claim: add-vs-drop value delta** side by side (the core dynasty claim
  decision). Shipped: `validateClaim` returns `valueDelta` (add value − drop value, rounded;
  null when the add has no known value) and the Waiver Wizard renders an **ADD / DROP / NET**
  card under the drop selector, net colored good/bad, so the dynasty trade-off is obvious.
  *(`FaRow` vs `PlayerLine` rendering the same entity two ways remains a dedup item under
  "Consolidate duplicated UX".)*
- [x] **Trades: value vs. construction verdicts** — a deterministic **bottom line**
  (`trades.bottomLine`, value verdict × construction rating → one take + tone) renders as a
  colored callout above Accept/Reject on both the inbox and the desk, so "You gain value" next
  to "⚠ hurts your roster" no longer leaves the decision ambiguous. **Now finished:** the raw
  market-value caption is de-emphasized (italic/uppercase footnote labeled "est. market value")
  so the bottom line reads as the answer; and the inbox shows **two-sided construction** — an
  incoming offer surfaces both my read and the offering team's (the backend already computed
  `partnerConstruction` for any known partner), matching the live builder.
- [x] **Home label collision:** fixed — the "Needs attention" tile now shows the count of
  action **items** (matching the feed it opens on tap) instead of a separate "leagues affected"
  number; the tile is tappable (opens the triage feed) and its player rows use `onOpenPlayer`.
- [~] **Consolidate duplicated UX:** one primary bulk-lineup path (wizard vs auto-set
  sheet), one shared claim builder (WaiverWizard vs ClaimSheet), one matchup component
  (recomputed in Scores/Lineups/Editor/Wizard with wording drift), shared `PlayerRow`.
  **Matchup done:** LineupsScreen + LineupEditorScreen each carried their own `winColor`
  (identical 0.6/0.4) and re-formatted the "vs <opp> · N% win" line; both now use the shared
  `components/MatchupLine.js` (exports `winColor`; compact vs detail variants). Scores was left
  as-is (its win-prob bands are server-computed, not a client threshold). **Claim value-delta
  shared:** the add-vs-drop dynasty delta is now one `components/ValueDelta.js` used by BOTH claim
  builders — the WaiverWizard and the FA-board ClaimSheet (which previously got `valueDelta` from
  the backend but never rendered it), so a quick FA claim shows the same trade-off as the wizard.
  *(Remaining, and larger — better paired with an on-device build: fully merging the two claim
  builders and the two bulk-lineup entry points into single flows, and folding the Players-screen
  local `PlayerRow`/`WatchRow` + Waivers `FaRow` onto the shared `PlayerRow`, which needs new
  optional props for quick-add + Target/Avoid markers.)*
- [x] **Portfolio `strengthLabel` thresholds are re-hardcoded client-side** (drift risk
  from the backend model) — source them from the backend. Done: `roster.strengthLabel`
  (shares `computeOutlook`'s 0.55/0.45 cut points) is folded into `teamSummary` and threaded
  onto the portfolio `byLeague` row; PortfolioScreen renders `l.strengthLabel` (local helper
  removed), LeaguesScreen carries it for parity.
- [~] **Roster: rookie picks are inert text** — done: draft picks on the roster are now
  first-class assets (dynasty value each + combined total, sorted soonest-first) and each is
  **tappable to shop it** — opens that league's trade desk on Propose with the pick pre-loaded
  on your side (`seed.sendPickToken`; pick value centralized in `lib/picks.value` so the roster
  and desk always agree). *(Remaining: a positional value breakdown of the roster.)*

## Owner writes unlocked by the confirmed MFL API

The full MFL Import **and Misc** references were captured on-device (2026-07-22, dbressler85's
login). All of these are **owner-accessible** (no commissioner cookie; the owner's own session
cookie authorizes them — `FRANCHISE_ID`/`FRANCHISE_PICK` is only for commissioner impersonation).
New features we can build on the strength of that confirmation:

- [x] **In-app drafting via `live_draft` — supersedes the make-a-pick 501.** Shipped: MFL's per-pick
  draft write is the **Misc** command `live_draft` (`year/live_draft?CMD=DRAFT&PLAYER_PICK&ROUND&PICK`,
  owner-accessible, `COMMENTS` "meant for email drafts"). Added `mfl.miscRequest` (the third command
  family beside export/import, with the same "OK" success-marker handling) and rewired
  `draft.makePick`: after its on-the-clock / your-pick / not-taken validation it fires
  `live_draft?CMD=DRAFT`, invalidates the league's cached reads, and optimistically overlays the pick
  on the board. Mobile now allows drafting in **live** too (was demo-only) with a confirmation that
  notes it submits to MFL and can't be undone from the app. Works for live AND slow/email drafts.
  Timer control (`PAUSE`/`RESUME`/`SKIP`/`UNDO`) is commissioner-only — out of scope. *(Remaining:
  verify the exact request against a live draft — MFL's Misc test form is the safe way; a slow/email
  draft is the low-stakes case to confirm on.)*
- [x] **My Draft List (auto-pick queue) — complements live drafting.** `import?TYPE=myDraftList`
  with `PLAYERS=<csv>` (owner; overwrites the prior list). Shipped: a **My Draft List editor**
  (`DraftListScreen`, reached from the Draft screen's ★ button) that frames it as a pre-draft /
  during-draft tool to narrow the pool — two panes (My List: reorder ⤒/↑/↓, remove, auto-fill
  top-10-by-value; Add players: value-ranked available pool + position chips + search), a
  status-aware banner ("on the clock" + "auto-picks next: <top undrafted on your list>"), drafted
  players greyed/struck, local edits with one Save (whole-set replace). Backend
  `draft.getDraftList`/`saveDraftList` + `GET/POST /api/leagues/:id/draftlist`; live seeds once from
  MFL's `myDraftList` export then writes back via the import. *(Remaining: live-account write
  verification, and one-tap "fill my needs" from the needs/surplus model.)*
- [x] **Injured-Reserve management.** `import?TYPE=ir` (`ACTIVATE` / `DEACTIVATE` / `DROP`). Shipped:
  per-player actions on the Roster screen — active players get **→ IR**, IR players get **Activate**.
  `roster.moveIr` + `POST /api/leagues/:id/ir`; demo reflects via a `rosterMoves` overlay, live
  writes MFL then re-reads. MFL enforces eligibility (needs an injury designation) — its error is
  surfaced. *(Remaining: live-write verification; optional "→ IR" shortcut on an injured player in
  the lineup editor.)*
- [x] **Taxi-squad management.** `import?TYPE=taxi_squad` (`PROMOTE` / `DEMOTE` / `DROP`). Shipped:
  active players get **→ Taxi**, taxi players get **Promote**, same Roster-screen action row.
  `roster.moveTaxi` + `POST /api/leagues/:id/taxi`. Taxi eligibility (rookie/young) is enforced by
  MFL and surfaced on rejection. *(Remaining: live-write verification.)*

*(Also confirmed owner-accessible and worth a later pass: `keepers` (keeper selections),
`myWatchList` (sync MFL's watch list with ours), and `chat_save` (post to league chat — Misc
command; note there's no API to **read** chat, only the `…/<league>_chat.xml` file). Not scheduled
yet. The Misc reference also confirms our `login` should be POST + HTTPS + `XML=1`, and the static
`mfl_status` / `nfl_sched` JSON feeds back our current-week + schedule reads.)*

## Design & motion

The app now has a **full design + motion system**, not just polish. The source of truth is
[`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) (color law: gold = value only, neon tier =
state/action; the glow recipe; spacing/type/motion scales) and
[`docs/MOTION_AND_NEON_ROADMAP.md`](docs/MOTION_AND_NEON_ROADMAP.md) (the four motion registers +
the neon-sign identity + the phased build). `theme.js` implements the tokens; screens consume them.

- [x] **Design-system tokens + `glow()`** — `colors`/`space`/`radius`/`size`/`weight`/`motion`/`shadow`
  and the neon glow recipe (edge + wash + iOS halo), plus `useReducedMotion`. `onAccent` fixes the
  white-on-accent contrast fail.
- [x] **Oswald display face** (`expo-font` + `@expo-google-fonts/oswald`), loaded defensively with a
  timeout fallback; on section labels, titles, and neon words. Numbers stay system-face for tabular
  alignment.
- [x] **Traversal (Phase 2)** — directional overlay lift-from-row open/close, tab slide + scale, and
  the app fall-in after login, all native-driven and reduce-motion-aware.
- [x] **Neon signature (Phase 4)** — `neon.js` flicker engine + `NeonSign`/`NeonGlyphs` (a wired sign
  that flickers on; two grades: moment vs steady inline), the **emoji → neon** sweep on the
  high-traffic surfaces (celebration, On Deck icons, Home, device-note bolt, Scores, League/Profile
  trophy), and `NeonSparks` replacing the confetti. Pure-text marks (`★ ☆ ›`) kept + tinted.
- [x] **Threshold (Phase 5)** — `NeonCrest` (the approved two-tone gem-lit crest in react-native-svg;
  lit + colored-dull-unlit states, flicker ignition) as the **login lockup** (rests unlit → ignites
  on sign-in → holds → fly-out), the **logout mirror** (app powers down → login flies in → crest
  flickers out), and the unlit crest as the **ambient app-background watermark**. Retires the old
  gold-filled `HubMark`.
- [x] **Texture (Phase 5)** — press feedback (`PressableScale`), skeleton shimmer (`Skeleton`), value
  roll-ups (`AnimatedNumber`), and the **acted-on-row flash** (`useActFlash`) on Target/Avoid/Watch +
  the on-the-block toggle. Active Target/Avoid/Watch icons light with the glow recipe.
- [x] **Neon app icon** — icon / adaptive-icon / splash / favicon re-rendered from the **lit** neon
  crest (glow dialed back for small-size legibility, verified at 96px).
- [~] **On-device tuning (needs the EAS build).** Settle live: ignition/fly-out timing; the in-app RN
  glow intensity (the live crest uses layered-stroke glow, not the icon's baked CSS glow);
  **Acid `#E4F24A` vs Neon Lime `#D6F84E`** for the watch accent, in-row; the Deep Ink background.
- [ ] **Neon tails (next build, `MOTION_AND_NEON_ROADMAP` §7).** Waiver/draft status-icon sets
  (`🟢 🔒 🗓` → new dot/lock/calendar glyphs) and the trophy hero cups (Trophy Case, Playoff Bracket)
  still use emoji; Texture's chip/segment pop-on-toggle and extending the flash to claim/trade rows.
- [ ] **Haptics.** Add `expo-haptics` so key actions (accept/reject trade, draft a pick, submit a
  claim) carry a physical tap — the one "vibrancy" lever RN `Animated` can't provide. Deferred to
  avoid adding a native dep mid-motion-pass; good to pair with the next build.

## Dynasty modeling & trade brain (expert review — 2026-07-27)

The plumbing, MFL correctness, and format detection are strong, and the trade *matching* heuristics
are good; the ceiling is held down by one recurring gap (the app reasons in dynasty ASSET value, never
win-now / rest-of-season) plus two narrower correctness issues. Ranked by value-to-effort:

- [ ] **Format-aware pick values (P1).** `lib/picks.js` `value()` is a single format-blind curve — no
  superflex / TE-premium premium and no rookie-class strength. In SF the 1.01 is a top-5 asset but is
  priced like a 1QB pick, and this flows straight into the trade brain (`pickPartners`). Pull
  FantasyCalc's per-format per-pick values (the enrichment layer already fetches per `{numQbs, ppr}`),
  or at minimum apply the SF/TEP premium to first-round picks. *(Effort low–med, high impact.)*
- [ ] **Blend standings/record into outlook (P1).** `roster.js` `computeOutlook` assigns
  win-now/rebuild from dynasty-value strength + core age only, so a 2-8 team with a stacked-but-
  underperforming roster reads "Win-now." Fold in real W-L / points (needs `leagueStandings`). *(Low
  effort, roadmap-ready; half the buy/sell signal at the deadline.)*
- [ ] **Win-now / rest-of-season value beside dynasty value on trades (P1).** `tradeMath.analyze`
  drives the headline favorable/fair/unfavorable purely on dynasty value, so a contender is told a
  "sell the vet for a pick + youth" deal is *favorable* — correct for assets, backwards for their
  window. (`tradefit.js` already knows "startability isn't dynasty value" for hole-detection — apply
  it to the verdict.) Carry a second ROS/win-now valuation and let team outlook decide which leads;
  projections already exist for the optimizer. *(Med effort — the single highest-impact correctness fix.)*
- [ ] **Cross-league value arbitrage (P2).** The app tracks player exposure across leagues but never
  says "you roster him in 3 leagues — he's worth most in your SF league; shop him *there*." A
  differentiated, on-brand insight this cross-league app is uniquely positioned to own. *(Med effort.)*
- [ ] **Production-weighted core age (P2, minor).** `coreAge` = the 5 *most valuable* players, and value
  is already age-discounted, so aging on-field studs get excluded from the very "how old is your core"
  average → aging teams look younger than they play. Weight by snaps/production instead of value.
- [ ] **Rookie/startup draft boards (P2).** Rookie drafts reuse the same keeper-ADP pool ordering with
  no rookie-specific tiers wired into the draft screen; startups have no value board. *(Med effort.)*

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

- [x] **DraftScreen: virtualize the player pool.** Done: the undrafted pool is now a
  `FlatList` (header/my-picks in `ListHeaderComponent`, recent picks in the footer) with a
  **memoized `PoolRow`**, so only the visible slice mounts instead of all several-hundred rows,
  and a 15s poll / filter tap no longer re-renders the whole board. `isPicking`/`pickingActive`
  are passed as booleans so drafting one player doesn't invalidate every row. *(Rows also got the
  press-spring + cascade for consistency.)*
- [x] **Stale-while-revalidate on the overview screens.** Lineups, Waivers, and the
  Players → Rankings tab now paint their last-known data from the on-device cache
  instantly and refetch in the background (`useCachedResource` hook + per-screen
  wiring), so they no longer cold-load with a blank spinner. Always revalidates
  (never skips the fetch), so there's no stale-after-action surprise — the trap
  that sank the earlier time-based Home gate. *(Not applied to Scores — it's live
  and freshness matters. Draft Hub and Trade Inbox could get the same treatment.)*
- [x] **Stale-while-revalidate SWEEP — the remaining blank-on-reload screens.** DONE (2026-07-27 audit:
  ~23/30 screens already kept prior data; the 7 that still blanked are all fixed). Principle: keep the
  old values on screen and revalidate in the background (a thin "refreshing" hint at most); reserve the
  blocking spinner for a genuine cold first-load with no cached data. All items below shipped:
  - [x] **P1 · WaiversScreen league board** — DONE. The board now seeds instantly from a per
    `leagueId+position+sort` resource-store key and keeps the prior board on screen during revalidate;
    the full spinner is gated on `!board`, a small inline "refreshing" hint shows while a shown board
    reloads, and a failed refetch is non-destructive. Filter/sort toggles and the post-cancel reload no
    longer blank the list.
  - [x] **P2 · PortfolioScreen error takeover** — DONE. Full-screen error now gated `if (fetchError && !d)`
    so a failed background refetch keeps the painted book; the failed shop-toggle / untag paths route to a
    toast (the row already reverts) instead of tripping the page-level error.
  - [x] **P2 · PlayersScreen Watch tab** — DONE. Dropped the `setWatch(null)` on open; it refetches in
    the background keeping the prior list (mirrors My Players), re-pricing on `format` change.
  - [x] **P2 · Leagues / Profile / Settings overlays** — DONE. The three bespoke `useState(null)` overlays
    now seed from the surviving in-memory store via `peekResource` (Leagues `leagues:list`, Profile `me` +
    the portfolio glance, Settings `settings:pushPrefs`) and prime on load, so re-opening repaints
    instantly and revalidates instead of cold-loading a full spinner.
  - [x] **P3 · LineupEditorScreen error gate** — DONE. Gated `if (error && !detail)` so a failed refetch
    after a seeded paint keeps the shown lineup instead of an error view.
  Closed all seven: the two error-gate bugs (Portfolio, LineupEditor) were the same `if (error)` →
  `if (error && !data)` class; the three overlay cold-loads were the same "not on the resource store"
  class; the Waivers board + Watch tab were spinners gated on `loading` rather than `!data`.
- [x] **Seed overlays from Home's already-fetched data.** Done: Home now write-throughs its
  `api.drafts()` / `api.onDeck()` results to the shared SWR cache keys (`'drafts'` / `'ondeck'`),
  and the **Draft Hub** was converted to `useCachedResource('drafts', …)` (On Deck already used
  `useCachedResource('ondeck', …)`), so opening either from Home paints Home's data instantly
  then revalidates — no cold spinner. (News isn't fetched on Home; it lives on the Players tab.)
- [~] **`React.memo` the long-list rows.** Done: the shared `PlayerRow` (Roster / Waivers /
  Trades / Watch) and the draft `PoolRow` are memoized, so a parent re-render no longer re-renders
  every visible row. *(Remaining: the Players-screen local `PlayerRow`/`WatchRow` and Waivers
  `FaRow` — they're declared after use (function hoisting), so memoizing needs a small reorder;
  low priority since those lists are already `FlatList`-virtualized.)*
- [ ] **Lift Home state above the overlay switch (optional).** `App.js` returns an
  overlay *instead of* the tab view, so opening/closing any overlay unmounts and
  remounts the active tab. The Home freshness gate mitigates the refetch cost;
  keeping the tab mounted under the overlay would remove the remount entirely.
- [x] **`SlotEditor` picker: memoize filter+sort.** Done — the eligible-candidates
  filter+sort is now a `useMemo` keyed on `players` / `slot.eligible`.
- [ ] **Enrichment provider in-flight coalescing (minor).** The four external
  providers (FantasyCalc / Sleeper / MFL topOwns / topAdds) cache resolved values,
  not in-flight promises. The snapshot memo already coalesces same-format callers;
  distinct-format concurrent cold callers could still double-fetch a provider.
  Low priority.
- [~] **Device-origin MFL reads + the single-device speed tradeoff.** Eligible per-user reads can
  run straight from the device (its own IP + MFL budget) with a silent backend fallback
  ([`docs/DEVICE_ORIGIN_MFL.md`](docs/DEVICE_ORIGIN_MFL.md)), gated by TWO flags AND-ed together:
  the app's build-time `EXPO_PUBLIC_DEVICE_READS` (baked into the binary — can't change on an
  installed app) and the backend's runtime `DEVICE_READS_ENABLED` (Render env — the master switch,
  flippable with no rebuild). **Open decision:** device-reads make the app slower on a *single*
  device (the split adds round-trips); until there are multiple devices to spread load, turn the
  Render master switch OFF (fast shared-backend path) and/or carve a `device-test` eas profile so
  device-reads only ship in an opt-in build.
- [x] **Cross-league fan-outs retry transient throttles.** A shared `withRetry` wraps the per-league
  reads (rosters, free agents, waiver **settings**, calendar, pending, exposure) so one 429/403 in a
  burst no longer surfaces as a spurious "couldn't load" for whichever league lost the race — it
  retries, then falls back honestly (partial flags, never a fabricated complete result).

## Data limitations (MFL doesn't expose these cleanly)

Tracked so we stay honest rather than fabricating. Revisit if MFL adds fields or we
add another data source.

- [x] **Real trade-deadline dates.** *(Earlier note was wrong — MFL DOES carry it.)* Read from the
  league `calendar` export's `TRADE_DEADLINE` event (`trades.nextTradeDeadline`, same shape as the
  waiver-process events) and auto-surfaced as a timed `trade_deadline` item on On Deck + shown on the
  trade desk. A manual per-league entry (store/tradeDeadlines, `POST /leagues/:id/trade-deadline`)
  overrides it for any league without one on the calendar.
- [x] **Machine-readable waiver run times.** Resolved via the `calendar` export
  (`nextWaiverRun` → real ms): On Deck sorts waiver items by time, and the Pending tab shows
  a live countdown, with MFL's human run-time string kept only as a fallback label.
- [ ] **Live projections floor/ceiling.** Floor/median/ceiling bands are a model
  estimate (position volatility around the projection), flagged as estimates in the
  UI — not a real distribution. A better source would replace the heuristic.
- [x] **Source tradeable picks from MFL's `assets` export.** Done: a live `assets` sample confirmed
  the shape and that our token construction was already correct (`DP_<round-1>_<pick-1>`,
  `FP_<owner>_<year>_<round>`). `picksLib.assetsByFranchise` reads the purpose-built export once →
  every franchise's players + FAAB + current/future picks already tokenized, with **post-trade
  ownership** (acquired picks under their current holder, incl. non-natural slots) and the original
  owner's **team name in each future pick's description**. Wired into the **pick inventory** (Pick
  Capital — "acquired from X" now comes free) and **trade construction** (`trades.getLeague`
  my/partner picks), each with a fallback to the old `draftResults` + `futureDraftPicks` composition
  (and the demo fixture). Also fixed the shipped-but-unused `normFranchiseAssets`, which had dropped
  the current-year (`DP_`) block. Verified by `mfl-repo` + `picks-assets` harnesses.

## Hardening & ops

- [ ] **Live-MFL verification against a real account.** The read/write shapes follow
  the public API docs but haven't been exercised end-to-end against a real login.
  Verify: `login`, `myleagues`, `rosters`, `players`, `liveScoring`, `schedule`,
  `projectedScores`, lineup/waiver/trade/drop imports. See
  [`backend/README.md`](backend/README.md#going-live--what-still-needs-verifying).
- [ ] **Push-notification delivery on a real device.** The scheduler + Expo push
  path is built; delivery (on-the-clock, new trade offers) needs a physical device
  with a real Expo push token to confirm end-to-end.
- [x] **Keep the Render instance warm.** Done: the service runs on Render's always-on
  `starter` plan (no idle sleep / cold starts), and a `keep-warm.yml` GitHub Action pings
  the health endpoint as a belt-and-suspenders backstop.
- [ ] **Play Store packaging.** Build + submit the Android app (EAS), store listing,
  and release channel.
