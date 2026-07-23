import { useCallback, useEffect, useRef, useState } from 'react';
import { getValue, setValue, onCacheInvalidate } from './cache';
import store from './resourceStore';

// Stale-while-revalidate for a screen's data, hardened for this app's navigation model: every
// top-level tab fully UNMOUNTS when you switch tabs or an overlay covers it, and remounts on
// return. The survive-remount + throttle + invalidation logic now lives in the pure, unit-tested
// `resourceStore` (see resourceStore.js and test/resourceStore.test.js for the C1–C3/C11
// contracts); this hook is the React glue over it. Non-destructive errors (C4) — a failed
// refetch keeps the last-known `data` and never nulls it — live here in the revalidate/effect.
//
// `key`     — cache key. Change it (per mode/tab) to switch datasets; the new key's value (memory
//             first, then disk) paints as soon as it's available.
// `fetcher` — async () => data. The latest closure is always used.
// `staleMs` — how long an in-memory value is trusted before a remount triggers a background reload.
const DEFAULT_STALE_MS = 45 * 1000;

// After any write (the api layer fires this) mark every snapshot stale — values stay for an
// instant paint, but the next mount refetches so post-action screens aren't stale (C3).
onCacheInvalidate(() => store.markAllStale());

// Clear the in-memory layer on logout / session loss so the next account never sees the
// previous one's data (C11). Mirrors the on-disk cache clear.
export function clearResourceCache() {
  store.clear();
}

// Direct access to the same in-memory layer for screens that manage their own fetch loop
// (e.g. the paginated Players rankings) but still want the survive-remount + throttle behavior
// and to be cleared by clearResourceCache() on logout. `peekResource` returns { value, at } or
// undefined; `primeResource` stores a value (default-stamped now, or at:0 to mark it stale).
export function peekResource(key) {
  return store.peek(key);
}
export function primeResource(key, value, at) {
  store.prime(key, value, at);
}

export default function useCachedResource(key, fetcher, { staleMs = DEFAULT_STALE_MS } = {}) {
  // Seed synchronously from the in-memory snapshot so a remount paints instantly, no null flash (C1).
  const [data, setData] = useState(() => (store.has(key) ? store.peek(key).value : null));
  const [error, setError] = useState(null);
  // `fetching` = any fetch in flight (drives the cold-load spinner). Seed true on a cold mount so
  // the loading state shows immediately instead of one empty frame. `refreshing` = USER-INITIATED
  // refresh only (a pull-to-refresh or retry) — this is what the pull-to-refresh control binds to,
  // so a SILENT background revalidate on a warm remount never flashes a spinner over painted content.
  const [fetching, setFetching] = useState(() => !store.has(key));
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const revalidate = useCallback(async (userInitiated = false) => {
    setFetching(true);
    if (userInitiated) setRefreshing(true);
    setError(null);
    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      store.prime(key, fresh); // freshen the in-memory snapshot
      setValue(key, fresh); // write-through so a cold app start still paints instantly from disk
      return fresh;
    } catch (e) {
      setError(e.message); // keep the last-known data — never blank on a failed refresh (C4)
      return null;
    } finally {
      setFetching(false);
      setRefreshing(false);
    }
  }, [key]);

  // Explicit user refresh (pull-to-refresh / retry): shows the pull control. The mount effect uses
  // revalidate(false) so its background reload stays silent.
  const reload = useCallback(() => revalidate(true), [revalidate]);

  useEffect(() => {
    let alive = true;
    const hit = store.peek(key);
    if (hit) {
      // Warm remount (or key change to an already-loaded dataset): paint from memory, and only
      // reload when it's gone stale — a quick return never re-runs the fetch (C2). SILENT: no
      // pull spinner over the already-painted content (that background sync is what felt odd).
      setData(hit.value);
      if (store.isStale(key, staleMs)) revalidate(false);
      return () => { alive = false; };
    }
    // Cold: no in-memory value for this key. Paint disk cache (async), then always revalidate.
    setData(null);
    getValue(key).then((cached) => {
      if (alive && cached != null) { setData(cached); store.prime(key, cached, 0); } // at:0 → stale, will refetch
      if (alive) revalidate(false);
    });
    return () => { alive = false; };
  }, [key, revalidate, staleMs]);

  return {
    data,
    error,
    fetching, // any fetch in flight (for a subtle, non-blocking hint if a screen wants one)
    refreshing, // USER-initiated refresh only → safe to bind a pull-to-refresh control to this
    // A blank full-screen spinner is only warranted when we have nothing to show at all.
    loading: data == null && fetching,
    reload,
    setData,
  };
}
