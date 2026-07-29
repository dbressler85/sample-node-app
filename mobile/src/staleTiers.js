// Client-side stale windows, tiered by how fast the underlying data actually moves — instead of
// revalidating everything on one flat 45s clock. A window governs only PASSIVE background revalidation
// on a warm remount / refocus (the SWR "is this snapshot old enough to re-check?" test). It never
// gates the instant paint, and it never holds back a user's own action: any write fires
// invalidateCaches() → markAllStale(), so post-action screens still refresh immediately (contract C3).
//
// The tiers mirror the backend's own TTL ladder (12s live → 24h static) so the client asks the backend
// about as often as the backend actually has something new — no more re-fetching a 12–24h-stable payload
// every 45 seconds of navigation.
export const STALE = {
  LIVE: 15 * 1000, //            scores, on-deck — moves play by play
  DEFAULT: 45 * 1000, //         the hook default: cross-league roll-ups, pending trades, waivers
  SLOW: 60 * 60 * 1000, //       1h  — player profiles, pick inventory/partners (change on trades, which write-invalidate)
  VALUES: 2 * 60 * 60 * 1000, // 2h  — player values / rankings boards (FantasyCalc refreshes ~12h; the prime keeps them warm)
  STATIC: 6 * 60 * 60 * 1000, // 6h  — team/franchise names, trophy case (essentially fixed mid-season)
};
