// Bug-report diagnostics (beta). A small in-memory breadcrumb ring + a one-shot snapshot of app/device
// state, gathered when the user taps the bug sign so a report carries context beyond their description.
// NOTHING here contains the destination address — the report POSTs to the backend, which holds the
// owner's private email in a server env var and does the send. The client never sees where it goes.
import { Platform, Dimensions } from 'react-native';
import Constants from 'expo-constants';

// Rolling breadcrumb buffer: the last N notable things that happened (screen changes, request failures,
// caught errors), oldest-first. Bounded so it can never grow. Timestamps are wall-clock for the report.
const MAX = 30;
const crumbs = [];
export function recordEvent(message, meta) {
  if (!message) return;
  crumbs.push({ at: new Date().toISOString(), message: String(message).slice(0, 300), ...(meta ? { meta } : {}) });
  if (crumbs.length > MAX) crumbs.splice(0, crumbs.length - MAX);
}
export function recentEvents() {
  return crumbs.slice();
}

// Capture otherwise-uncaught JS errors as breadcrumbs, CHAINING the previous handler so we never
// swallow the app's own crash handling. Safe to call once at startup; a no-op if ErrorUtils is absent.
let installed = false;
export function installGlobalErrorCapture() {
  if (installed || typeof global === 'undefined' || !global.ErrorUtils) return;
  installed = true;
  const prev = global.ErrorUtils.getGlobalHandler && global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((err, isFatal) => {
    try { recordEvent(`${isFatal ? 'fatal' : 'error'}: ${err && err.message ? err.message : err}`); } catch (e) { /* never let logging break the handler */ }
    if (typeof prev === 'function') prev(err, isFatal);
  });
}

// A snapshot of what's going on right now — app version, device/OS, the screen the user is on, their
// entitlement + demo state, and the breadcrumb trail. `extra` lets the caller add live context (the
// active tab, entitlement) the module can't read on its own. The username is NOT included here — the
// backend derives it from the authenticated session, so a report can't be spoofed to another account.
export function collectDiagnostics(extra = {}) {
  const win = Dimensions.get('window');
  const ec = Constants.expoConfig || {};
  return {
    capturedAt: new Date().toISOString(),
    app: {
      version: ec.version || null,
      runtime: (Constants.expoRuntimeVersion || (ec.runtimeVersion && ec.runtimeVersion.policy) || null),
      channel: Constants.channel || null,
    },
    device: {
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      model: Constants.deviceName || null,
      screen: `${Math.round(win.width)}x${Math.round(win.height)}`,
    },
    state: {
      screen: extra.screen || null,
      entitlement: extra.entitlement || null,
      demoMode: extra.demoMode != null ? !!extra.demoMode : null,
    },
    events: recentEvents(),
  };
}
