import { useCallback, useEffect, useRef, useState } from 'react';
import { getValue, setValue } from './cache';

// Stale-while-revalidate for a screen's data: paint the last-known value from the
// on-device cache instantly, then ALWAYS refetch in the background and update in
// place. Never skips the refetch (that's what makes it safe — no stale-after-action
// surprises); it just removes the blank full-screen spinner on every open.
//
// `key`     — disk cache key. Change it (e.g. per mode/tab) to switch datasets;
//             the cached value for the new key paints immediately if present.
// `fetcher` — async () => data. Always the latest closure is used.
export default function useCachedResource(key, fetcher) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const revalidate = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      setValue(key, fresh); // write-through so the next open paints instantly
      return fresh;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [key]);

  useEffect(() => {
    let alive = true;
    // Paint cached for THIS key first (blank while switching to a not-yet-cached
    // key), then revalidate.
    setData(null);
    getValue(key).then((cached) => {
      if (alive && cached != null) setData(cached);
      if (alive) revalidate();
    });
    return () => { alive = false; };
  }, [key, revalidate]);

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
