import { getEntry, setValue } from './cache';
import { primeResource } from './useCachedResource';
import { api, bg } from './api';
import { waiversOverviewPreferDevice, lineupsPreferDevice, deviceReadsReady } from './mflDevice';
import { isCellular } from './net';

// Idle prefetch. While the user sits on one tab, quietly warm the on-device caches for
// the OTHER tabs so switching to them paints instantly from disk instead of showing a
// blank spinner while the (sometimes slow) cross-league read runs. Only safe, read-only
// GETs go here — never anything with a side effect — and each writes straight to the
// exact SWR cache key its screen reads on open.
// `device: true` marks a prefetch that fans a per-user read out across every league straight from MFL on
// the device's own IP — the heavy one (lineups: rosters × all leagues). Speculatively WARMING it costs the
// user's battery + cellular data for a tab they may never open, so it's skipped on cellular (U-2). The
// lightweight backend GETs (and the FA pool, now backend-only per A-10) stay — they're cheap and worth the
// instant-paint. Nothing here is user-REQUESTED, so gating speculative warming on cellular is allowed
// (unlike A-10, which never gates a feature on the network type).
// Every fetch here is speculative (a tab the user hasn't opened), so it runs at LOW MFL priority (Fix
// A) — "nothing they're clicking needs to be loaded." A tap into any of these tabs fires its own
// NORMAL read that preempts whatever's still warming.
const RESOURCES = [
  { tab: 'trades', key: 'trades:overview', fetch: () => bg(() => api.trades()) },
  { tab: 'players', key: 'players:rankings:value:all:1qb:std', fetch: () => bg(() => api.playerRankings('value', null, '1qb')) },
  { tab: 'waivers', key: 'waivers:overview', fetch: () => waiversOverviewPreferDevice(true) },
  { tab: 'lineups', key: 'lineups:auto', fetch: () => lineupsPreferDevice('auto', true), device: true },
  { tab: 'scores', key: 'scores:overview', fetch: () => bg(() => api.scoreboard()) },
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
  // Be frugal on cellular (U-2): when a device fan-out WOULD run (flag on + creds) AND we're on a cellular
  // link, skip speculatively warming the heavy device-origin tabs — they'll load on demand when opened. On
  // wifi (or when device reads are off, so the prefetch is a cheap backend read) nothing is skipped.
  const frugal = (await deviceReadsReady()) && (await isCellular());
  for (const res of RESOURCES) {
    if (res.tab === activeTab) continue;
    if (res.device && frugal) continue;
    await warm(res);
  }
}
