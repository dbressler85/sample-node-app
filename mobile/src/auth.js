// Persist the backend session token in the device's secure store so the user
// stays logged in across app launches. The MFL password is never stored here —
// only the opaque backend token.
//
// Device-origin reads (docs/DEVICE_ORIGIN_MFL.md): when enabled, we ALSO cache this session's MFL
// cookie (+ host/season) in SecureStore so the app can read straight from MFL on its own IP. The
// cookie is a bearer credential for the user's OWN account on their OWN device — SecureStore only,
// never logged, wiped on logout alongside the token.
import * as SecureStore from 'expo-secure-store';
import { setToken, api } from './api';
import { DEVICE_READS } from './config';

const KEY = 'dc_session_token';
const CREDS_KEY = 'dc_mfl_creds';

// Best-effort: pull this session's MFL cookie so device-origin reads can work. A 404 (device reads
// disabled on the backend) or any error just means we skip it and the app keeps using the backend.
async function fetchAndStoreMflCreds() {
  if (!DEVICE_READS) return;
  try {
    const creds = await api.mflCreds();
    if (creds && creds.cookie) await SecureStore.setItemAsync(CREDS_KEY, JSON.stringify(creds));
  } catch (e) {
    /* device reads not enabled / unreachable — fine, fall back to the backend */
  }
}

export async function loadMflCreds() {
  try {
    const raw = await SecureStore.getItemAsync(CREDS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// U-7: when a device read is rejected with an EXPIRED MFL cookie, re-pull this session's cookie from the
// backend — if the backend has since re-authed (a fresh cookie), the device catches up instead of silently
// falling back forever on a stale cookie. If the backend's cookie is ALSO expired, its own reads fail and
// the normal session-expiry → re-login flow takes over. Best-effort; never throws.
export async function refreshMflCreds() {
  await fetchAndStoreMflCreds();
}

export async function saveSession(token) {
  setToken(token);
  await SecureStore.setItemAsync(KEY, token);
  await fetchAndStoreMflCreds();
}

export async function loadSession() {
  const token = await SecureStore.getItemAsync(KEY);
  if (token) setToken(token);
  return token;
}

export async function clearSession() {
  setToken(null);
  await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(CREDS_KEY); // logout wipe includes the MFL cookie
}
