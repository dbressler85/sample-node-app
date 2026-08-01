// Imperative bridge for the account-level (comped) entitlement, so App — which owns auth state but sits
// ABOVE the EntitlementProvider it renders (and so can't consume its context) — can tell the provider to
// (re)read /api/me after login and to reset on logout. The provider registers its handlers on mount;
// App calls these module functions. Dependency-free, like paywallBus.
let handlers = null;

export function _setAccountEntitlementHandlers(h) {
  handlers = h;
}

// Re-read the signed-in account's comped flag from /api/me (call after a successful login).
export function refreshEntitlementAccount() {
  if (handlers && handlers.refresh) handlers.refresh();
}

// Clear the comped flag (call on logout / auth loss).
export function resetEntitlementAccount() {
  if (handlers && handlers.reset) handlers.reset();
}
