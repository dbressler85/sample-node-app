# Portfolio — team-level analytics + sub-tab restructure

Adds a **team-as-unit** view to Portfolio (per-team value, trend, outlook, format, capital) and
restructures the now-long screen into sub-tabs.

## Framing

Portfolio today aggregates only by **player** (top holdings, arbitrage, value-at-risk) and by
**position** (allocation). There is no view where **your team in each league** is the unit. That's the
gap. The backend already builds a per-team `byLeague[]` (value / outlook / strength / coreAge / at-risk)
— we **enrich that**, we don't duplicate it.

**Principle:** Home = *act* (triage). Portfolio = *analyze* (understand your empire). Keep these tabs
analytical — no lineup/waiver action items (those live on Home / On-Deck).

## Information architecture (sub-tabs)

A `ChipSelect`/segmented control at the top of `PortfolioScreen`:

| Tab | Holds |
|---|---|
| **Overview** | Total value, portfolio trend sparkline, outlook-mix pie, top movers, attention/mismatch callouts |
| **Teams** *(new)* | Sortable list of your rosters: value · trend · share · outlook · strength% · record/seed · age · pick capital; tap → detail |
| **Holdings** | Existing player roll-up (top holdings, exposure, arbitrage) + value-at-risk |
| **Allocation** | Existing position allocation **+** format/settings distribution + positional-demand insight |

## Team-level metrics (brainstorm → phased)

- **Value & momentum:** team value, 7/30-day trend, sparkline, **share of empire**, gainer/loser leaderboard.
- **Competitiveness:** outlook-mix pie (win-now/ascending/balanced/rebuilding), **contender-window mismatch**
  (win-now roster + losing record → sell; ascending + winning → go for it), league strength percentile,
  playoff seed, roster age profile.
- **Format distribution:** QB (1QB vs SF), PPR, TE-premium, league-size — and the **derived** insight
  (e.g. "9/12 leagues Superflex → QBs are your scarcest, most liquid chips").
- **Capital:** pick-capital roll-up (future 1sts/2nds per team + total), FAAB remaining, open/taxi spots.
- **Risk (per team):** top-player concentration, age-cliff exposure, injury/bye exposure.
- **Positional strength per team:** where each team is strong/thin → wire into the trade suggester.

## Data inventory

Already computed per league (in `byLeague` / `roster.summary`): value, coreAge, strengthPct,
strengthLabel, outlook, atRiskValue/Pct, tradeDeadline. Format is available via `leagueFormat.format`.
**New data needed:** per-team value **history** (today we store total-portfolio + per-player history,
not per-league) → new `leagueValueHistory` store. Record (W-L/seed) needs a standings read.

## Phased build

- **Phase 1 — backend (this PR):** enrich each `byLeague` entry with `share`, `trend7`, `history`
  (sparkline), and `format`; add a portfolio-level `formatMix`. New `leagueValueHistory` store (durable,
  auto-encrypted). Demo seeds synthetic per-league history. Schema + smoke updated. No mobile change.
- **Phase 2 — mobile:** add the sub-tab bar to `PortfolioScreen`; build the **Teams** tab (value / trend
  / share / outlook / strength / format per team, sortable), and fold **format distribution** into
  Allocation. Charts follow the color law (gold = value; outlook hues: win-now = warn, ascending = good,
  balanced/rebuilding = dim; positions = `positionColors`). Load the `dataviz` skill for the pie/bars.
- **Phase 3 — insight layer:** contender-window **mismatch** flags (needs a standings read → record/seed),
  pick-capital roll-up, age profile, positional strength, and the format→positional-demand insight.
- **Phase 4 — polish:** per-team detail drill-in, empire-share + gainer/loser leaderboard, reduce-motion +
  a11y pass on the new charts.

## Notes

- The Portfolio zod contract is fail-soft (extra keys pass through untouched), so additive fields are
  safe; we still document them as optional in `apiSchema.Portfolio`.
- Per-team trend is **real** history from day one (new store), not a summed-delta approximation.
- Keep the existing `byLeague` key name (mobile reads it) — we enrich in place.
