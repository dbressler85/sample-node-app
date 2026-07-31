// Backend base URL.
//
// The phone talks to YOUR backend (never to MFL directly). Set this per build:
//   EXPO_PUBLIC_API_URL=https://your-backend.example.com  npx expo start
//
// Notes:
//  * On a physical device with Expo Go, "localhost" points at the phone, not your
//    dev machine — use your computer's LAN IP (e.g. http://192.168.1.20:4000) or a
//    tunnel/hosted URL.
//  * Trailing slashes are trimmed for you.
const raw = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

export const API_URL = raw.replace(/\/+$/, '');

// Device-origin reads (docs/DEVICE_ORIGIN_MFL.md, spike). When '1', the app fetches eligible per-user
// reads straight from MFL on-device (its own IP + MFL rate budget), with a silent backend fallback.
// OFF by default; it ALSO requires the backend's DEVICE_READS_ENABLED (only then is the session cookie
// handed to the device). Enable per build: EXPO_PUBLIC_DEVICE_READS=1.
export const DEVICE_READS = process.env.EXPO_PUBLIC_DEVICE_READS === '1';

// Pro entitlements enforcement. OFF by default: the entitlement layer still computes the tier + trial
// and renders the paywall UI, but every gate is ALLOWED, so the live app is unchanged until billing +
// data licensing are ready. Flip to '1' (EXPO_PUBLIC_ENFORCE_PRO=1) only after RevenueCat is wired and
// the FantasyCalc/RotoBaller commercial terms are signed.
export const ENFORCE_PRO = process.env.EXPO_PUBLIC_ENFORCE_PRO === '1';

// RevenueCat public SDK key (Android) — a PUBLISHABLE key (safe in the client, starts with "goog_").
// When unset, the billing layer stays in stub/dormant mode (no store calls), so Expo Go and the current
// APK keep working. Set it via eas.json env or an EAS secret once RevenueCat is configured. See
// docs/REVENUECAT_SETUP.md.
export const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || null;

// Public URLs for the hosted legal docs + the support contact, surfaced in Profile → Account (a Google
// Play requirement once you charge). Replace the placeholders with your real hosted URLs / email — via
// these env vars or by editing the fallbacks. See docs/play-store/TERMS.md + PRIVACY_POLICY.md.
export const LEGAL = {
  terms: process.env.EXPO_PUBLIC_TERMS_URL || 'https://dynastycentral.app/terms',
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL || 'https://dynastycentral.app/privacy',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@dynastycentral.app',
};
