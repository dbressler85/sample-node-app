import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

// Calls `fn` every `intervalMs` while `active` is true, the screen is mounted, AND
// the app is in the foreground. Overlapping runs are skipped (a slow fetch won't
// stack), and `fn` is always the latest closure so it can read fresh state. Pausing
// while backgrounded stops live surfaces (draft board / hub, Sunday scoreboard, On
// Deck) from firing requests the user can't see — a battery/data drain otherwise.
export default function usePoll(fn, intervalMs, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  const running = useRef(false);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active || !foreground || !intervalMs) return undefined;
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
  }, [active, foreground, intervalMs]);
}
