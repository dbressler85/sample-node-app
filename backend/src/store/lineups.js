'use strict';

// Remembers lineups the user has applied, keyed by account + league + WEEK. In DEMO
// mode this is the source of truth (there's no real MFL to write to). In LIVE mode
// it's only a short-lived optimistic hint on top of the real MFL submission — the
// service trusts it just long enough to cover MFL's write→read propagation, then
// falls back to the freshly-read roster (which reflects external edits and the new
// week). Keying by week + stamping `at` is what stops a set lineup from leaking
// across weeks or masking a later change. Durable via store/persist.

const persist = require('./persist');

const db = () => persist.ns('lineups'); // 'account:leagueId:week' -> { starterIds, at }
const key = (account, leagueId, week) => `${account}:${leagueId}:${week}`;

function set(account, leagueId, week, starterIds) {
  db()[key(account, leagueId, week)] = { starterIds: starterIds.slice(), at: Date.now() };
  persist.touch();
}

// Returns { starterIds, at } for the applied lineup, or null. The freshness/mode
// policy (authoritative in demo, short-lived hint in live) lives in the service.
function get(account, leagueId, week) {
  const rec = db()[key(account, leagueId, week)];
  if (!rec) return null;
  if (Array.isArray(rec)) return { starterIds: rec.slice(), at: 0 }; // legacy pre-week shape → treat as stale
  return { starterIds: (rec.starterIds || []).slice(), at: rec.at || 0 };
}

module.exports = { set, get };
