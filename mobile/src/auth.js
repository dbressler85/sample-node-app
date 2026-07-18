// Persist the backend session token in the device's secure store so the user
// stays logged in across app launches. The MFL password is never stored here —
// only the opaque backend token.
import * as SecureStore from 'expo-secure-store';
import { setToken } from './api';

const KEY = 'dc_session_token';

export async function saveSession(token) {
  setToken(token);
  await SecureStore.setItemAsync(KEY, token);
}

export async function loadSession() {
  const token = await SecureStore.getItemAsync(KEY);
  if (token) setToken(token);
  return token;
}

export async function clearSession() {
  setToken(null);
  await SecureStore.deleteItemAsync(KEY);
}
