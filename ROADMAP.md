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
- [ ] **League switcher / mute / pin.** Let the owner pin the leagues they care about
  to the top of every cross-league view, and mute leagues (e.g. finished or
  bye-week teams) so they drop out of Home triage, On Deck, and exposure.
- [ ] **Trade negotiation: counter-offers.** Trades support propose / accept / reject
  and cross-league "trade for" today; add counter-offer (respond to an incoming
  offer with a modified package) via MFL `import?TYPE=tradeProposal` threading.
- [ ] **Waiver Wizard: multi-add per league.** The wizard picks one add/drop per
  league; allow queuing several claims per league with FAAB budgeting across them.

## Performance & caching backlog

The big wins are shipped (parallelized per-league fan-outs; cached `listLeagues` /
`franchiseNames`; promise-coalescing MFL read cache; memoized `getRoster` /
free-agent reads; memoized enrichment snapshot, `leagueFormat.format`, player
ranks, news crosswalk, bye map; compiled scoring; slice-before-annotate in the
player hub). Remaining, in rough priority order:

- [ ] **DraftScreen: virtualize the player pool.** `DraftScreen` renders the
  undrafted pool with `ScrollView` + `.map` (hundreds of rows, re-rendered on a
  15s poll and every filter tap). Convert to `FlatList` with `keyExtractor`,
  header/my-picks in `ListHeaderComponent`. *(Deferred: needs on-device UI
  verification, not just a parse-check.)*
- [ ] **Stale-while-revalidate on the other overview screens.** Only Home uses the
  AsyncStorage disk cache (paint cached instantly, always revalidate in the
  background). Extend that pattern to Lineups, Waivers, Scores, Draft Hub, and Trade
  Inbox so tab switches paint instantly instead of cold-loading with a spinner.
  Note: a time-based "skip refresh if fresh" gate was tried on Home and **reverted**
  — it left triage stale after an action taken in an overlay (e.g. a lineup just
  set). Any freshness gate must be **mutation-aware** (invalidate the cached view
  when the user performs a write that changes it), not purely time-based.
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
