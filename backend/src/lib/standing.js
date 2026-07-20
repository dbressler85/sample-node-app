'use strict';

// "Where does this player stand?" — the one canonical read of a player's relationship to
// a single league's roster + free-agent set. Three surfaces used to each roll their own,
// with subtly (and confusingly) different vocabularies: the watchlist called MY roster
// "mine" and another team "rostered"; the profile called MY roster "rostered" and another
// team "unavailable". The classification now lives here once; callers map it to whatever
// labels their API already exposes.
//
// Canonical `where`:
//   'starter' | 'bench' | 'ir' | 'taxi'  — on this roster (mine), in that slot
//   'free'                                — a free agent you could claim
//   'other'                               — on another team's roster (a trade target)

// The getRoster / myRosterLight bucket arrays, paired with their slot name. Single source
// of truth for the bucket set, so exposure and the single-player classifier agree.
const BUCKETS = [
  ['starters', 'starter'],
  ['bench', 'bench'],
  ['ir', 'ir'],
  ['taxi', 'taxi'],
];

// The slot a player occupies on this roster, or null if he isn't on it. Works on light
// ({id}) and full (enriched) rosters alike — both expose `.id` on each bucket entry.
function rosterBucket(roster, id) {
  for (const [key, name] of BUCKETS) {
    const list = roster && roster[key];
    if (list && list.some((p) => p.id === id)) return name;
  }
  return null;
}

// Canonical standing of `id` against one roster + free-agent set.
//   { where, mine, bucket } — bucket is the slot name when mine, else null.
function standing(roster, faSet, id) {
  const bucket = rosterBucket(roster, id);
  if (bucket) return { where: bucket, mine: true, bucket };
  if (faSet && faSet.has(id)) return { where: 'free', mine: false, bucket: null };
  return { where: 'other', mine: false, bucket: null };
}

module.exports = { BUCKETS, rosterBucket, standing };
