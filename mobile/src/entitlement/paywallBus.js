// Tiny imperative bus so any action call site can surface the paywall without threading navigation —
// same shape as components/AppAlert's `appAlert`, but kept in its own dependency-free module so the
// entitlement hook and the paywall host can both use it with no import cycle.
//   presentPaywall({ action, source, ... })  → shows it
//   _setPaywallEmitter(fn)                    → the <PaywallHost/> subscribes on mount
let emit = null;

export function _setPaywallEmitter(fn) {
  emit = fn;
}

export function presentPaywall(context = {}) {
  if (emit) emit(context);
}
