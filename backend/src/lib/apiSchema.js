'use strict';

const { z } = require('zod');

// Response contracts at the API boundary.
//
// The mobile app assumes response shapes wholesale (see mobile/src/api.js): a renamed or dropped
// backend field passes every backend test and then silently breaks a screen at runtime. These
// zod schemas make that drift observable — they encode the fields a screen RELIES ON. Extra
// backend fields are fine (zod ignores unknown keys), so the backend stays free to add data; only
// a missing/renamed/mistyped *relied-on* field trips the check.
//
// FAIL SOFT (UX_GUARDRAILS C4/C5): `checkResponse` never alters or withholds the payload and never
// throws — on drift it logs a one-line warning and returns the ORIGINAL bytes untouched, so a
// schema mistake or an unforeseen live shape can never turn into a 500 or a stripped response. The
// hard enforcement (drift must fail CI) lives in the test net (test/live/schema-boundary-test.js),
// which strict-parses real demo output — that's where a rename fails a test instead of a screen.
//
// Convention: value-nullable fields use .nullable() (present, but may be null in live/offseason);
// .optional() is only for keys that may be entirely absent. Both still catch a *rename* (the old
// key goes undefined and, unless optional, fails).

// --- shared fragments -------------------------------------------------------

const MatchupSide = z.object({
  name: z.string(),
  score: z.number(),
  projected: z.number().nullable().optional(),
});

const RosterPlayer = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string(),
  team: z.string().nullable().optional(),
  value: z.number().nullable().optional(),
});

const StandingRow = z.object({
  rank: z.number(),
  franchiseId: z.string(),
  name: z.string(),
  mine: z.boolean(),
  record: z.string().nullable().optional(),
  pointsFor: z.number().nullable().optional(),
  pointsAgainst: z.number().nullable().optional(),
  inPlayoffs: z.boolean().nullable().optional(),
});

// --- endpoint schemas -------------------------------------------------------

// GET /api/dashboard
const Dashboard = z.object({
  season: z.union([z.number(), z.string()]).nullable().optional(),
  leagues: z.array(
    z.object({
      leagueId: z.string(),
      name: z.string(),
      franchiseId: z.string(),
      week: z.number().nullable().optional(),
      matchup: z
        .object({
          me: MatchupSide,
          opponent: MatchupSide.nullable().optional(),
        })
        .nullable(), // null in the offseason; a *renamed* matchup key still trips (undefined)
      record: z.string().nullable().optional(),
      standingRank: z.number().nullable().optional(),
    })
  ),
});

// GET /api/leagues
const Leagues = z.object({
  leagues: z.array(
    z.object({
      leagueId: z.string(),
      name: z.string(),
      franchiseId: z.string(),
      franchiseName: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      pinned: z.boolean(),
    })
  ),
});

// GET /api/leagues/:leagueId/roster
const Roster = z.object({
  leagueId: z.string(),
  name: z.string().nullable().optional(),
  starters: z.array(RosterPlayer),
  bench: z.array(RosterPlayer),
  ir: z.array(RosterPlayer),
  taxi: z.array(RosterPlayer),
  // Backend sends pick objects now; tolerate a stale cached string (the mobile row does too).
  picks: z
    .array(z.union([z.object({ label: z.string() }), z.string()]))
    .nullable()
    .optional(),
  summary: z
    .object({
      rosterValue: z.number().nullable().optional(),
      outlook: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

// GET /api/leagues/:leagueId/standings
const Standings = z.object({
  leagueId: z.string(),
  name: z.string().nullable().optional(),
  playoffSpots: z.number().nullable().optional(),
  me: StandingRow.nullable().optional(),
  standings: z.array(StandingRow),
});

// GET /api/portfolio — the cross-league dynasty dashboard. Pins the structural sections a
// rename would blank (totals / holdings / byLeague / ageCurve / atRisk); the many advisory
// blocks (movers, concentration, seasonal, …) are UI-guarded and left unvalidated.
const Portfolio = z.object({
  totals: z.object({
    leagues: z.number(),
    rosterValue: z.number(),
    playerCount: z.number().nullable().optional(),
    valueWeightedAge: z.number().nullable().optional(),
  }),
  holdings: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      position: z.string(),
      value: z.number(),
      leagues: z.number(),
    })
  ),
  byLeague: z.array(
    z.object({
      leagueId: z.string(),
      name: z.string(),
      value: z.number().nullable().optional(),
    })
  ),
  ageCurve: z.array(z.object({ band: z.string(), value: z.number(), pct: z.number() })),
  atRisk: z.object({ pct: z.number() }),
});

// GET /api/scoreboard — live matchups across leagues.
const Scoreboard = z.object({
  week: z.number().nullable().optional(),
  games: z.array(
    z.object({
      leagueId: z.string(),
      name: z.string(),
      me: z.object({ score: z.number() }),
      opp: z.object({ score: z.number() }).nullable().optional(),
      winProb: z.number().nullable().optional(),
      status: z.string().nullable().optional(),
    })
  ),
});

// GET /api/lineups — cross-league lineup overview (points gap + matchup per league).
const Lineups = z.object({
  week: z.number().nullable().optional(),
  mode: z.string().nullable().optional(),
  leagues: z.array(
    z.object({
      leagueId: z.string(),
      name: z.string(),
      currentTotal: z.number().nullable().optional(),
      optimalTotal: z.number().nullable().optional(),
      delta: z.number().nullable().optional(),
      status: z.string().nullable().optional(),
    })
  ),
});

const schemas = { Dashboard, Leagues, Roster, Standings, Portfolio, Scoreboard, Lineups };

// Validate a response payload against its schema, FAIL SOFT. Returns the payload unchanged in all
// cases; on drift it logs one concise line (label + up to 5 offending paths) and moves on. Never
// throws — callers can `res.json(checkResponse(schemas.X, payload, 'GET /x'))` safely.
function checkResponse(schema, payload, label) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues;
    const shown = issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join(' | ');
    const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : '';
    console.warn(`[schema drift] ${label} — ${shown}${more}`);
  }
  return payload;
}

module.exports = { schemas, checkResponse };
