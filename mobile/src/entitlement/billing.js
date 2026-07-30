// Billing — RevenueCat (react-native-purchases) behind the app's stable interface. Google Play collects
// the money and owns renewals/refunds; RevenueCat wraps the native billing SDK and is the source of
// truth for "is this user Pro?" (entitlement `pro`). See docs/REVENUECAT_SETUP.md.
//
// GUARDED: when EXPO_PUBLIC_REVENUECAT_ANDROID_KEY is unset — or the native module isn't present (Expo
// Go) — this falls back to a local dev stub, so the current APK and Expo Go keep working untouched.
// Real purchases only happen in a build that has the native module AND the key configured.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { REVENUECAT_ANDROID_KEY } from '../config';

// Optional native module: require defensively so a missing/unlinked module (Expo Go) can't crash the
// app at import — we degrade to the stub instead.
let Purchases = null;
try {
  // eslint-disable-next-line global-require
  Purchases = require('react-native-purchases').default || require('react-native-purchases');
} catch (e) {
  Purchases = null;
}

// The RevenueCat entitlement the app checks. Must match the entitlement id in the RevenueCat dashboard.
export const ENTITLEMENT_ID = 'pro';

// Fallback display plans — shown before the store's offerings load, or if the store is unreachable / the
// stub is active. Real, store-localized prices come from getOfferings() → package.product.priceString.
export const PLANS = [
  { id: 'annual', title: 'Annual', priceString: '$44.99', period: 'yr', per: '$3.75/mo', highlight: true, badge: 'Best value · save 53%' },
  { id: 'monthly', title: 'Monthly', priceString: '$7.99', period: 'mo', per: null, highlight: false, badge: null },
];

const DEV_PRO_KEY = 'dc_dev_pro_v1'; // stub-only manual override (Expo Go / no key) so the flow is demoable

let configured = false;
let available = false; // RevenueCat usable: key set AND native module present
let packageById = {}; // 'annual'|'monthly' -> RC package, populated by getOfferings for purchase()

export async function configure() {
  if (configured) return;
  configured = true;
  if (!REVENUECAT_ANDROID_KEY || !Purchases || typeof Purchases.configure !== 'function') {
    available = false; // dormant → stub behavior
    return;
  }
  try {
    Purchases.configure({ apiKey: REVENUECAT_ANDROID_KEY });
    available = true;
  } catch (e) {
    available = false;
  }
}

function normalize(info) {
  const active = info && info.entitlements && info.entitlements.active ? info.entitlements.active[ENTITLEMENT_ID] : null;
  return {
    subscribed: !!active,
    plan: active ? active.productIdentifier : null,
    willRenew: active ? active.willRenew : null,
    expiresAt: active ? active.expirationDate : null,
    source: 'revenuecat',
  };
}

async function stubInfo() {
  try {
    const dev = await AsyncStorage.getItem(DEV_PRO_KEY);
    return { subscribed: dev === '1', plan: dev === '1' ? 'dev' : null, source: 'stub' };
  } catch (e) {
    return { subscribed: false, plan: null, source: 'stub' };
  }
}

// Whether the account holds an active Pro entitlement.
export async function getCustomerInfo() {
  if (!available) return stubInfo();
  try {
    return normalize(await Purchases.getCustomerInfo());
  } catch (e) {
    return { subscribed: false, plan: null, source: 'revenuecat-error' };
  }
}

// Map an RC package to the app's stable id by billing period, so the paywall's annual/monthly selection
// works regardless of the RC package identifiers; also stash the RC package for purchase().
function mapPackage(pkg) {
  const p = pkg.product || {};
  const isAnnual = pkg.packageType === 'ANNUAL';
  const id = isAnnual ? 'annual' : 'monthly';
  packageById[id] = pkg;
  return {
    id,
    title: isAnnual ? 'Annual' : 'Monthly',
    priceString: p.priceString || (isAnnual ? '$44.99' : '$7.99'),
    period: isAnnual ? 'yr' : 'mo',
    per: isAnnual ? '$3.75/mo' : null,
    highlight: isAnnual,
    badge: isAnnual ? 'Best value · save 53%' : null,
  };
}

// The plans the paywall renders. Store-localized packages when available; the static fallback otherwise.
export async function getOfferings() {
  if (!available) return PLANS;
  try {
    const offerings = await Purchases.getOfferings();
    const cur = offerings && offerings.current;
    const pkgs = cur && Array.isArray(cur.availablePackages) ? cur.availablePackages : [];
    packageById = {};
    const mapped = pkgs
      .filter((pk) => pk.packageType === 'ANNUAL' || pk.packageType === 'MONTHLY')
      .map(mapPackage);
    // Keep annual first (the lead plan) for the paywall's ordering.
    mapped.sort((a, b) => (a.id === 'annual' ? -1 : 1) - (b.id === 'annual' ? -1 : 1));
    return mapped.length ? mapped : PLANS;
  } catch (e) {
    return PLANS;
  }
}

// Run the purchase. Store path uses the native purchase sheet; a user cancel is not an error (returns
// current entitlement unchanged). Stub path flips the dev override so the flow is demoable without a store.
export async function purchase(planId) {
  if (!available) {
    await AsyncStorage.setItem(DEV_PRO_KEY, '1');
    return { subscribed: true, plan: planId, source: 'stub' };
  }
  const pkg = packageById[planId];
  if (!pkg) {
    // Offerings not loaded yet (paywall calls getOfferings on mount, but be defensive).
    await getOfferings();
  }
  const chosen = packageById[planId];
  if (!chosen) throw new Error('Selected plan is unavailable.');
  try {
    const { customerInfo } = await Purchases.purchasePackage(chosen);
    return normalize(customerInfo);
  } catch (e) {
    if (e && e.userCancelled) return getCustomerInfo(); // cancel → no change, no error surfaced
    throw e;
  }
}

export async function restore() {
  if (!available) return stubInfo();
  try {
    return normalize(await Purchases.restorePurchases());
  } catch (e) {
    return { subscribed: false, plan: null, source: 'revenuecat-error' };
  }
}

// Stub-only helper for a "reset Pro" dev affordance; harmless when RevenueCat is live.
export async function _devClearPro() {
  try {
    await AsyncStorage.removeItem(DEV_PRO_KEY);
  } catch (e) {
    /* noop */
  }
}
