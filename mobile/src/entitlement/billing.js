// Billing abstraction. The app talks to THIS interface only; today it's a stub (no native dependency,
// so it runs in Expo Go and the current APK). Swap the stub body for RevenueCat when you're ready to
// charge — the interface and every caller stay identical.
//
// ── RevenueCat swap-in (do this once licensing is signed) ─────────────────────────────────────────
//   1. npx expo install react-native-purchases        (needs a dev client / EAS build — not Expo Go)
//   2. configure():        Purchases.configure({ apiKey: <Google Play RevenueCat key> })
//   3. getCustomerInfo():  const i = await Purchases.getCustomerInfo();
//                          return { subscribed: !!i.entitlements.active.pro, plan, willRenew: ... }
//   4. getOfferings():     map Purchases.getOfferings().current.availablePackages → PLANS
//                          (use each package's STORE-localized product.priceString, not the hardcodes below)
//   5. purchase(pkg):      await Purchases.purchasePackage(pkg)     restore(): Purchases.restorePurchases()
//   Only after this is wired + tested should you set EXPO_PUBLIC_ENFORCE_PRO=1.
// ──────────────────────────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

// The plans the paywall renders. priceString is hardcoded for the stub; RevenueCat supplies the
// store-localized price at runtime (prefer that once wired). Annual leads; monthly is the decoy.
export const PLANS = [
  { id: 'annual', title: 'Annual', priceString: '$44.99', period: 'yr', per: '$3.75/mo', highlight: true, badge: 'Best value · save 53%' },
  { id: 'monthly', title: 'Monthly', priceString: '$7.99', period: 'mo', per: null, highlight: false, badge: null },
];

// Stub-only manual override so the whole flow (paywall → "purchase" → Pro state) is demoable without a
// store account. RevenueCat replaces this with the real entitlement.
const DEV_PRO_KEY = 'dc_dev_pro_v1';

let configured = false;
export async function configure() {
  if (configured) return;
  configured = true;
  // RevenueCat: Purchases.configure({ apiKey }) goes here.
}

// Whether the account holds an active Pro entitlement. Stub: false unless the dev override is set.
export async function getCustomerInfo() {
  try {
    const dev = await AsyncStorage.getItem(DEV_PRO_KEY);
    return { subscribed: dev === '1', plan: dev === '1' ? 'dev' : null, source: 'stub' };
  } catch (e) {
    return { subscribed: false, plan: null, source: 'stub' };
  }
}

export async function getOfferings() {
  return PLANS;
}

// Stub purchase: flips the dev override so the paywall's CTA visibly grants Pro end-to-end. Replace
// with Purchases.purchasePackage. Returns the new customer info.
export async function purchase(planId) {
  await AsyncStorage.setItem(DEV_PRO_KEY, '1');
  return { subscribed: true, plan: planId, source: 'stub' };
}

export async function restore() {
  return getCustomerInfo();
}

// Stub-only helper for a "reset Pro" dev affordance; harmless once RevenueCat is wired.
export async function _devClearPro() {
  try {
    await AsyncStorage.removeItem(DEV_PRO_KEY);
  } catch (e) {
    /* noop */
  }
}
