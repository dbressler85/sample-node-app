// Haptic feedback — the one "vibrancy" lever RN Animated can't provide. A thin wrapper over
// expo-haptics, lazily required so the app never crashes if the native module isn't in the build
// (Expo Go / not yet installed). Two guards keep it tasteful:
//   • Gated on the OS "reduce motion" setting — a user who opted out of motion opts out of buzzes too.
//     (Mirrors useReducedMotion, but at module scope so plain functions like toast()/celebrate() can use it.)
//   • Lightly debounced PER KIND, so one action that fires both a celebrate() and a toast() success
//     doesn't double-buzz — while a press `tap` followed by a result `success` (different kinds) still
//     both land, which is the intended "commit, then confirmed" feel.

import { AccessibilityInfo } from 'react-native';

let Haptics = null;
try {
  // eslint-disable-next-line global-require
  Haptics = require('expo-haptics');
} catch (e) {
  Haptics = null;
}

// OS reduce-motion preference, tracked at module scope. Defaults false; refreshed on load + on change.
let reduced = false;
if (AccessibilityInfo && AccessibilityInfo.isReduceMotionEnabled) {
  AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduced = !!v; }).catch(() => {});
  if (AccessibilityInfo.addEventListener) AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { reduced = !!v; });
}

let lastAt = 0;
let lastKind = '';
function fire(kind, fn) {
  if (!Haptics || reduced) return;
  const now = Date.now();
  if (kind === lastKind && now - lastAt < 250) return; // collapse a same-kind double (celebrate + toast)
  lastAt = now;
  lastKind = kind;
  try { fn(); } catch (e) { /* haptics are best-effort — never let a buzz throw */ }
}

// selection — a light tick for a discrete choice; tap — a firmer commit; success/warning/error —
// outcome notifications matching the app's success (celebrate/toast), warn, and failure surfaces.
export const haptics = {
  selection: () => fire('selection', () => Haptics.selectionAsync()),
  tap: () => fire('tap', () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => fire('success', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => fire('warning', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => fire('error', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

export default haptics;
