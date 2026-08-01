# Beta live-test checklist

The one thing no automated test or agent can do: exercise the real MFL read/write path against **your
own account**. This is the pre-beta gate (PO pass, must-have #1). Run it on a real login before handing a
build to any external tester — a broken write on day 1 ends the beta before feedback starts.

Owner has already live-validated: **draft pick · trade propose · trade bait · waivers**. This checklist
focuses on what's **still unproven live**, then a fast regression sweep of the rest.

## Still unproven — verify these first

### Set-All lineups (the headline paid feature — highest priority)
- [ ] Lineups tab loads all leagues; each shows a status (Optimal / Risk / Not set / Points available).
- [ ] "Auto-set all leagues" builds a review sheet showing the **diff** (who's benched → who starts) per
      league, and lets you deselect leagues.
- [ ] Confirm applies — then **open MyFantasyLeague directly** for 2–3 of those leagues and confirm the
      starting lineup there matches what the app set. (This is the trust-make-or-break: a Set-All that
      silently mis-sets a lineup is worse than not having the feature.)
- [ ] A league with a locked player / bye / IR slot doesn't get an illegal lineup pushed.
- [ ] Re-run Set-All when everything's already optimal → "nothing to change," no spurious writes.

### Push notifications (verify on a physical device)
- [ ] Grant notification permission on first run; confirm the token registers (no error).
- [ ] Trigger one of each you care about and confirm it actually arrives: draft on the clock, trade
      offer received, waiver clearing soon. (These are notifications you plan to sell — they must land.)

### First-run + cold load (real 15-league account)
- [ ] Fresh install → login → the welcome modal explains one-login / the beta (bug reporting) / values /
      credentials, and the Hub is warm by the time you tap Enter.
- [ ] Time the full cold load with all real leagues. Is "Updating N/15…" tolerable, or does it feel
      broken? (The whole product's first impression rides on this.)
- [ ] Force a partial load (background the app mid-load, or a flaky connection) → the Hub donut / portfolio
      trend / trades inbox show "N of M loaded" and never a fake number, never a blank.

## Regression sweep (already tested — re-confirm after this cycle's fixes)
- [ ] **Draft:** open a live draft board (no "Could not load"), make a pick, confirm it lands on MFL and
      the board updates; the pace-aware poll doesn't spam errors.
- [ ] **Waivers:** the overview loads every league (no "could not load settings"), file a claim, cancel a
      claim, run the Waiver Wizard across leagues.
- [ ] **Trades:** inbox shows real pending offers; accept / reject / propose / withdraw; trade bait board.
- [ ] **Bug report:** tap the white bug sign, send a report; confirm it arrives (once a delivery transport
      is set — see docs/BUG_REPORTS.md) or is persisted server-side.
- [ ] **Trophy case:** "Find my titles" auto-detects championships (and now silver/bronze) without
      inventing a false podium in a league with a consolation bracket.

## Notes
- Backend fixes deploy on merge (Render); mobile fixes need an EAS build — make sure the build under test
  actually contains the mobile changes you're validating (uninstall first; installs no-op over an
  existing app).
- If a write misbehaves, file it through the bug sign — the diagnostics (screen, breadcrumbs, device)
  come attached.
