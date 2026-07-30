import React, { useEffect, useState } from 'react';
import { _setPaywallEmitter } from '../entitlement/paywallBus';
import PaywallScreen from '../screens/PaywallScreen';

// Mounted once at the app root (like AppAlertHost): renders the paywall on top of everything whenever
// presentPaywall(...) is called from an action gate or a "Go Pro" tap. Null when nothing is pending.
export function PaywallHost() {
  const [ctx, setCtx] = useState(null);
  useEffect(() => {
    _setPaywallEmitter((c) => setCtx(c || {}));
    return () => _setPaywallEmitter(null);
  }, []);
  if (!ctx) return null;
  return <PaywallScreen context={ctx} onClose={() => setCtx(null)} />;
}
