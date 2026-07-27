import { useEffect, useRef, useState } from 'react';

// Auto-heal a PARTIAL cross-league result. When a load returns leaguesLoaded < leaguesTotal (some
// leagues dropped to a transient MFL throttle), quietly re-run `reload` after a growing delay — up to
// `max` times — so the missing leagues fill in on their own, no "Retry" tap needed. `reload` must
// refetch WITHOUT clearing the current data, so the list stays on screen and the loaded count just
// climbs (visible progress). Returns { retrying, exhausted } for the note's wording:
//   • retrying  — an auto-reload is scheduled/in flight (show "Loading N of M…", hide the manual Retry).
//   • exhausted — gave up after `max` tries (fall back to the manual Retry affordance).
// The attempt budget resets when the load completes or `key` (tab / value lens) changes.
export default function useAutoReload(data, reload, { max = 4, baseDelayMs = 2500, key } = {}) {
  const attempts = useRef(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    attempts.current = 0;
    setRetrying(false);
  }, [key]);

  useEffect(() => {
    if (!data) return undefined; // mid-load — hold the counter and wait for the result
    const total = Number(data.leaguesTotal);
    const loaded = Number(data.leaguesLoaded);
    const partial = Number.isFinite(total) && Number.isFinite(loaded) && loaded < total;
    if (!partial) {
      attempts.current = 0;
      setRetrying(false);
      return undefined;
    }
    if (attempts.current >= max) {
      setRetrying(false); // give up quietly — the manual Retry stays available
      return undefined;
    }
    setRetrying(true);
    const delay = Math.round(baseDelayMs * Math.pow(1.6, attempts.current)); // gentle backoff
    const t = setTimeout(() => {
      attempts.current += 1;
      reload();
    }, delay);
    return () => clearTimeout(t);
  }, [data, reload, max, baseDelayMs]);

  const exhausted = !!(
    data &&
    Number(data.leaguesLoaded) < Number(data.leaguesTotal) &&
    attempts.current >= max
  );
  return { retrying, exhausted };
}
