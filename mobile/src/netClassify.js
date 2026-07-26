'use strict';

// Pure classifier for expo-network's getNetworkStateAsync() result, split from net.js so it's unit-testable
// without the native module. "Cellular" = a CONNECTED cellular link. Unknown / wifi / disconnected → false,
// so a caller that restricts on cellular stays permissive when the type is unknown (fail-open — a missing
// or undetectable network never over-restricts). Used ONLY to make speculative prefetch frugal (U-2), never
// to gate user-requested content (the PO's rule; A-10).
function isCellularState(state) {
  return !!(state && state.type === 'CELLULAR' && state.isConnected !== false);
}

module.exports = { isCellularState };
