import { useEffect } from 'react';
import { BackHandler } from 'react-native';

// Register an Android hardware-back / edge-swipe-back handler.
// `handler` returns true if it consumed the back action, false to let the next
// handler (or the OS) take it. Handlers registered later run first, so a screen's
// own handler (e.g. "close my open sheet") runs before the app-level navigation.
export default function useAndroidBack(handler) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [handler]);
}
