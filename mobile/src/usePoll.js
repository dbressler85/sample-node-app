import { useEffect, useRef } from 'react';

// Calls `fn` every `intervalMs` while `active` is true and the screen is mounted.
// Overlapping runs are skipped (a slow fetch won't stack), and `fn` is always the
// latest closure so it can read fresh state. Used to make live surfaces (draft
// board / hub, Sunday scoreboard, On Deck) auto-refresh without a manual pull.
export default function usePoll(fn, intervalMs, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  const running = useRef(false);

  useEffect(() => {
    if (!active || !intervalMs) return undefined;
    const id = setInterval(async () => {
      if (running.current) return;
      running.current = true;
      try {
        await saved.current();
      } catch (e) {
        /* transient poll error — keep polling */
      } finally {
        running.current = false;
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}
