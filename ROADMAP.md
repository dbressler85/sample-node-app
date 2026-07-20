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
  (tap → profile) and a per-league breakdown. *(Next: expiring-contract risk where
  MFL exposes it; a value-trend sparkline once we retain snapshots.)*
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
- [ ] **League switcher / mute / pin.** Let the owner pin the leagues they care about
  to the top of every cross-league view, and mute leagues (e.g. finished or
  bye-week teams) so they drop out of Home triage, On Deck, and exposure.
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
  → locked), shown on the landing + walked-past in the wizard. Still open:
  **multi-add per league** — queue several claims in one league with FAAB budgeting
  across them. *(Calendar parser is best-effort against an unverified response
  shape — text-scans lock/unlock semantics tolerant of field-name/format variation;
  tighten once verified against a real league's calendar response.)*

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
