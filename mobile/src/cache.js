import AsyncStorage from '@react-native-async-storage/async-storage';

// Tiny on-device cache for slow-changing data (league list, last-known statuses)
// so screens paint instantly from disk while fresh data loads in the background
// (stale-while-revalidate). Values are stored as { at, value }.
const PREFIX = 'dc_cache_';

export async function getEntry(key) {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export async function getValue(key) {
  const entry = await getEntry(key);
  return entry ? entry.value : null;
}

export async function setValue(key, value) {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch (e) {
    /* ignore cache write failures */
  }
}

export async function clearAll() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
  } catch (e) {
    /* ignore */
  }
}

// Cross-screen cache invalidation. Screens keep in-memory snapshots and throttle their
// reloads (so read-only navigation doesn't refetch), but a WRITE (set a lineup, submit a
// claim, propose/accept a trade, add/drop, star) must make the affected screens refetch on
// next view. Rather than wire every mutation to every screen, the api layer fires
// `invalidateCaches()` after any successful non-GET, and each screen registers a listener
// that marks its snapshot stale — values stay for instant paint, but the next mount reloads.
const invalidators = new Set();
export function onCacheInvalidate(fn) {
  invalidators.add(fn);
  return () => invalidators.delete(fn);
}
export function invalidateCaches() {
  for (const fn of invalidators) { try { fn(); } catch (e) { /* ignore */ } }
}
