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
      tradeDeadline: z.object({ at: z.number(), date: z.string(), source: z.string() }).nullable().optional(),
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

// A player identity row (rankings / best-available / watchlist all share this relied-on core).
const PlayerIdentity = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string(),
  value: z.number().nullable().optional(),
});

// GET /api/me — signed-in manager identity + league count (Profile screen).
const Me = z.object({
  username: z.string().nullable(), // behind auth, but the handler defaults to null defensively
  account: z.string().nullable().optional(),
  season: z.union([z.number(), z.string()]).nullable().optional(),
  leagues: z.number(),
});

// GET /api/players/rankings — the paginated rankings board.
const Rankings = z.object({
  players: z.array(PlayerIdentity),
  total: z.number().nullable().optional(),
  hasMore: z.boolean().nullable().optional(),
});

// GET /api/players/compare — side-by-side comparison of up to 4 players.
const Compare = z.object({
  players: z.array(z.object({ id: z.string(), name: z.string(), position: z.string() })),
});

// GET /api/players/:id — the cross-league player profile. Pins the two sections the screen reads
// UNGUARDED (crossLeague[].relation drives the ownership map; actions.add/dropLeagues gate the
// action bar); the many rich-but-optional blocks (outlook/season/gameLog/schedule/news) are
// UI-guarded and left unvalidated.
const Profile = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string(),
  crossLeague: z.array(
    z.object({
      leagueId: z.string(),
      name: z.string(),
      relation: z.string(),
    })
  ),
  actions: z.object({
    addLeagues: z.array(z.any()),
    dropLeagues: z.array(z.any()),
  }),
});

// GET /api/waivers/overview — the per-league landing list (some entries may carry an error).
const WaiversOverview = z.object({
  leagues: z.array(
    z.object({
      leagueId: z.string(),
      name: z.string(),
      system: z.string().nullable().optional(),
      rosterCount: z.number().nullable().optional(),
      rosterSize: z.number().nullable().optional(),
    })
  ),
  summary: z.object({ total: z.number() }).nullable().optional(),
});

// GET /api/waivers/best-available — cross-league free agents.
const WaiversBest = z.object({
  players: z.array(PlayerIdentity),
});

// GET /api/waivers/pending — pending claims + recent results.
const WaiversPending = z.object({
  pending: z.array(
    z.object({
      id: z.string(),
      leagueId: z.string(),
      leagueName: z.string().nullable().optional(),
    })
  ),
  results: z.array(z.any()),
  summary: z.object({ pending: z.number() }).nullable().optional(),
});

// GET /api/watchlist — the watched players.
const Watchlist = z.object({
  players: z.array(PlayerIdentity),
});

// GET /api/watchlist/alerts — home-screen watch alerts (item shape empty in demo; pins the key).
const WatchlistAlerts = z.object({
  alerts: z.array(z.any()),
});

// --- secondary endpoints ----------------------------------------------------
// Each pins the structural list/section its screen reads unguarded; rich per-row detail that the
// UI already guards is left off so the backend can keep evolving it without tripping drift.

// GET /api/home — cross-league command center (portfolio roll-up + per-league team list + triage).
const Home = z.object({
  phase: z.string().nullable().optional(),
  week: z.number().nullable().optional(),
  portfolio: z.object({ leagues: z.number() }).nullable().optional(),
  teams: z.array(z.object({ leagueId: z.string(), name: z.string() })),
  triage: z.array(z.any()),
});

// GET /api/home/league/:leagueId — one league's triage items (the progressive Home fan-out).
const HomeLeague = z.object({
  leagueId: z.string(),
  name: z.string(),
  tradeDeadline: z.object({ at: z.number(), date: z.string(), source: z.string() }).nullable().optional(),
  items: z.array(z.object({ id: z.string(), type: z.string() })),
});

// GET /api/news — league-relevant player news.
const News = z.object({
  news: z.array(z.object({ id: z.string(), headline: z.string() })),
});

// GET /api/ondeck — time-sorted deadlines across leagues.
const OnDeck = z.object({
  items: z.array(z.object({ type: z.string() })),
});

// GET /api/players/exposure — every league you roster each player in.
const Exposure = z.object({
  players: z.array(PlayerIdentity),
});

// GET /api/players/search — universe search results.
const Search = z.object({
  players: z.array(PlayerIdentity),
  total: z.number().nullable().optional(),
});

// GET /api/tags — the account's player Target/Avoid tags (id -> tag map).
const Tags = z.object({
  tags: z.record(z.string(), z.any()),
});

// GET /api/drafts — cross-league draft status list.
const Drafts = z.object({
  drafts: z.array(
    z.object({ leagueId: z.string(), name: z.string(), status: z.string().nullable().optional() })
  ),
});

// GET /api/picks — your cross-league draft-pick inventory, grouped by year.
const PickInventory = z.object({
  summary: z.object({ total: z.number(), totalValue: z.number(), firsts: z.number(), leagues: z.number() }),
  byYear: z.array(z.object({ year: z.number().nullable(), picks: z.array(z.object({ token: z.string(), label: z.string() })) })),
});

// GET/POST /api/leagues/:leagueId/draftlist — the owner's ranked My Draft List + add-pool.
const DraftList = z.object({
  leagueId: z.string(),
  name: z.string(),
  status: z.string(),
  nextUp: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  list: z.array(z.object({ id: z.string(), name: z.string(), position: z.string(), drafted: z.boolean() })),
  available: z.array(z.object({ id: z.string(), name: z.string(), position: z.string() })),
});

// GET /api/leagues/:leagueId/draft — the draft grid.
const DraftBoard = z.object({
  leagueId: z.string(),
  name: z.string(),
  board: z.array(z.object({ overall: z.number(), round: z.number(), pick: z.number() })),
});

// GET /api/leagues/:leagueId/teams — every franchise's roster (opponent scouting).
const Teams = z.object({
  leagueId: z.string(),
  teams: z.array(z.object({ franchiseId: z.string(), name: z.string() })),
});

// GET /api/leagues/:leagueId/transactions — the recent-activity feed.
const Transactions = z.object({
  leagueId: z.string(),
  transactions: z.array(z.object({ id: z.string(), type: z.string() })),
});

// GET /api/leagues/:leagueId/lineup — the lineup editor detail (slots + player pool).
const LineupDetail = z.object({
  leagueId: z.string(),
  name: z.string(),
  slots: z.array(z.object({ name: z.string(), eligible: z.array(z.string()).nullable().optional() })),
  players: z.array(RosterPlayer),
  optimal: z.object({ total: z.number().nullable().optional() }).nullable().optional(),
});

// GET /api/lineups/plan — the "Set All" preview, one diff per league.
const LineupPlan = z.object({
  leagues: z.array(z.object({ leagueId: z.string(), name: z.string() })),
});

// GET /api/leagues/:leagueId/waivers — one league's waiver board.
const WaiverBoard = z.object({
  leagueId: z.string(),
  name: z.string(),
  system: z.string().nullable().optional(),
  freeAgents: z.array(PlayerIdentity),
});

// GET /api/waivers/suggestions — the waiver-wizard per-league recommendations.
const WaiverSuggestions = z.object({
  leagues: z.array(z.object({ leagueId: z.string(), name: z.string() })),
});

// GET /api/tradebait — cross-league trade-bait board.
const TradeBait = z.object({
  leagues: z.array(z.object({ leagueId: z.string(), name: z.string() })),
});

// GET /api/tradebait/market — every OTHER franchise's block across your leagues.
const TradeMarket = z.object({
  leagues: z.array(z.object({ leagueId: z.string(), name: z.string() })),
});

// GET /api/leagues/:leagueId/tradebait — the player ids you have on the block in one league.
const LeagueTradeBait = z.object({
  ids: z.array(z.any()),
});

// GET /api/trades — cross-league trade offers inbox.
const Trades = z.object({
  offers: z.array(z.object({ id: z.string(), leagueId: z.string() })),
});

// GET /api/leagues/:leagueId/trades — one league's trade desk (my assets + partners).
const LeagueTrades = z.object({
  leagueId: z.string(),
  myPlayers: z.array(PlayerIdentity),
});

const schemas = {
  Dashboard,
  Leagues,
  Roster,
  Standings,
  Portfolio,
  Scoreboard,
  Lineups,
  Me,
  Rankings,
  Compare,
  Profile,
  WaiversOverview,
  WaiversBest,
  WaiversPending,
  Watchlist,
  WatchlistAlerts,
  Home,
  HomeLeague,
  News,
  OnDeck,
  Exposure,
  Search,
  Tags,
  Drafts,
  DraftBoard,
  DraftList,
  PickInventory,
  Teams,
  Transactions,
  LineupDetail,
  LineupPlan,
  WaiverBoard,
  WaiverSuggestions,
  TradeBait,
  TradeMarket,
  LeagueTradeBait,
  Trades,
  LeagueTrades,
};

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
