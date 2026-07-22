import { useCallback, useEffect, useRef, useState } from 'react';
import { getValue, setValue, onCacheInvalidate } from './cache';

// Stale-while-revalidate for a screen's data, hardened for this app's navigation model: every
// top-level tab fully UNMOUNTS when you switch tabs or an overlay covers it, and remounts on
// return. Three layers keep that from blanking or needlessly reloading:
//
//  1. In-memory snapshot (module-level `mem`, survives unmount) → the value paints SYNCHRONOUSLY
//     on remount, so returning to a tab shows its last state with no blank flash / lost scroll.
//  2. Throttle → a remount within `staleMs` repaints from memory and does NOT hit the network;
//     only genuinely stale data (or a manual `reload()`) refetches. This is what stops "it
//     reloads everything every time I go back."
//  3. Non-destructive errors → a failed refetch keeps the last-known data (never nulls it), so a
//     transient backend hiccup on re-entry can't wipe a screen that was already populated.
//
// `key`     — cache key. Change it (per mode/tab) to switch datasets; the new key's value (memory
//             first, then disk) paints as soon as it's available.
// `fetcher` — async () => data. The latest closure is always used.
// `staleMs` — how long an in-memory value is trusted before a remount triggers a background reload.
const mem = new Map(); // key -> { value, at }
const DEFAULT_STALE_MS = 45 * 1000;

// After any write (api layer fires this), mark every snapshot stale — keep the values for an
// instant paint, but force the next mount to refetch so post-action screens aren't stale.
onCacheInvalidate(() => { for (const v of mem.values()) v.at = 0; });

// Clear the in-memory layer on logout / session loss so the next account never sees the
// previous one's data. Mirrors the on-disk cache clear.
export function clearResourceCache() {
  mem.clear();
}

// Direct access to the same in-memory layer for screens that manage their own fetch loop
// (e.g. the paginated Players rankings) but still want the survive-remount + throttle behavior
// and to be cleared by clearResourceCache() on logout. `peekResource` returns { value, at } or
// undefined; `primeResource` stores a value (default-stamped now, or at:0 to mark it stale).
export function peekResource(key) {
  return mem.get(key);
}
export function primeResource(key, value, at = Date.now()) {
  mem.set(key, { value, at });
}

export default function useCachedResource(key, fetcher, { staleMs = DEFAULT_STALE_MS } = {}) {
  // Seed synchronously from the in-memory snapshot so a remount paints instantly (no null flash).
  const [data, setData] = useState(() => (mem.has(key) ? mem.get(key).value : null));
  const [error, setError] = useState(null);
  // Start "refreshing" when there's no in-memory value, so a cold mount shows the loading state
  // immediately instead of one empty frame before the effect's revalidate flips it on.
  const [refreshing, setRefreshing] = useState(() => !mem.has(key));
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const revalidate = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      mem.set(key, { value: fresh, at: Date.now() });
      setValue(key, fresh); // write-through so a cold app start still paints instantly from disk
      return fresh;
    } catch (e) {
      setError(e.message); // keep the last-known data — never blank on a failed refresh
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [key]);

  useEffect(() => {
    let alive = true;
    const hit = mem.get(key);
    if (hit) {
      // Warm remount (or key change to an already-loaded dataset): paint from memory, and only
      // reload when it's gone stale — a quick return never re-runs the fetch.
      setData(hit.value);
      if (Date.now() - hit.at > staleMs) revalidate();
      return () => { alive = false; };
    }
    // Cold: no in-memory value for this key. Paint disk cache (async), then always revalidate.
    setData(null);
    getValue(key).then((cached) => {
      if (alive && cached != null) { setData(cached); mem.set(key, { value: cached, at: 0 }); } // at:0 → stale, will refetch
      if (alive) revalidate();
    });
    return () => { alive = false; };
  }, [key, revalidate, staleMs]);

  return {
    data,
    error,
    refreshing,
    // A blank full-screen spinner is only warranted when we have nothing to show.
    loading: data == null && refreshing,
    reload: revalidate,
    setData,
  };
}
