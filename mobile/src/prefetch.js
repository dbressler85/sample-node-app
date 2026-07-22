import { getEntry, setValue } from './cache';
import { primeResource } from './useCachedResource';
import { api } from './api';

// Idle prefetch. While the user sits on one tab, quietly warm the on-device caches for
// the OTHER tabs so switching to them paints instantly from disk instead of showing a
// blank spinner while the (sometimes slow) cross-league read runs. Only safe, read-only
// GETs go here — never anything with a side effect — and each writes straight to the
// exact SWR cache key its screen reads on open.
const RESOURCES = [
  { tab: 'trades', key: 'trades:overview', fetch: () => api.trades() },
  { tab: 'players', key: 'players:rankings:value:all:1qb', fetch: () => api.playerRankings('value', null, '1qb') },
  { tab: 'waivers', key: 'waivers:overview', fetch: () => api.waiversOverview() },
  { tab: 'lineups', key: 'lineups:auto', fetch: () => api.lineups('auto') },
  { tab: 'scores', key: 'scores:overview', fetch: () => api.scoreboard() },
];

// Don't re-warm a cache that a screen (or an earlier prefetch) already filled recently.
// Every cache entry carries its write time, so this window also skips the tab the user
// just came from — no redundant fetch right after they leave it.
const FRESH_MS = 90 * 1000;
const inFlight = new Set();

async function warm(res) {
  if (inFlight.has(res.key)) return;
  const entry = await getEntry(res.key);
  if (entry && Date.now() - entry.at < FRESH_MS) return;
  inFlight.add(res.key);
  try {
    const data = await res.fetch();
    await setValue(res.key, data);
    // Prime the in-memory layer too (stamped now), so opening the just-warmed tab paints
    // instantly AND its throttle skips the immediate reload — the point of prefetching.
    primeResource(res.key, data);
  } catch (e) {
    /* best-effort — a failed prefetch just means the screen loads normally when opened */
  } finally {
    inFlight.delete(res.key);
  }
}

// Warm every tab except the active one, ONE AT A TIME. Sequential on purpose: a burst of
// heavy cross-league reads would compete with whatever the screen the user is actually on
// is doing — this keeps prefetch strictly in the background ("nothing they're clicking
// needs to be loaded"). Fire-and-forget; the caller schedules it after a settle delay.
export async function prefetchOtherTabs(activeTab) {
  for (const res of RESOURCES) {
    if (res.tab === activeTab) continue;
    await warm(res);
  }
}
