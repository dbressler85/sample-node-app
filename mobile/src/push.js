// Push-notification registration. Kept defensive: expo-notifications is a native
// module, so we require it lazily and no-op if it's unavailable (e.g. running in
// Expo Go without a dev build, or the dep not installed) — the app must never
// crash just because push isn't set up.

import { Platform } from 'react-native';
import { api } from './api';

let Notifications = null;
let Device = null;
let Constants = null;
try {
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
  // eslint-disable-next-line global-require
  Device = require('expo-device');
  // eslint-disable-next-line global-require
  Constants = require('expo-constants').default;
} catch (e) {
  Notifications = null;
}

// Show notifications while the app is foregrounded, too.
if (Notifications && Notifications.setNotificationHandler) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

// Ask permission, get the Expo push token, and register it with the backend.
// Safe to call on every login; returns null if push isn't available/granted.
export async function registerForPush() {
  if (!Notifications) return null;
  try {
    if (Device && Device.isDevice === false) return null; // simulators can't get a token
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    if (Platform.OS === 'android' && Notifications.setNotificationChannelAsync) {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Dynasty Central',
        importance: Notifications.AndroidImportance ? Notifications.AndroidImportance.HIGH : 4,
      });
    }

    // Pass the EAS projectId EXPLICITLY. It normally auto-resolves from app config, but if that
    // lookup ever fails the call throws and (being wrapped in this try/catch) the whole registration
    // silently returns null — one of the ways push can be quietly dead. Passing it is the safe form.
    const projectId =
      (Constants && Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas && Constants.expoConfig.extra.eas.projectId) ||
      (Constants && Constants.easConfig && Constants.easConfig.projectId) ||
      undefined;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    if (!token) return null;
    await api.registerPush(token).catch(() => {});
    return token;
  } catch (e) {
    return null; // push is best-effort
  }
}

export async function unregisterPush() {
  try {
    await api.unregisterPush();
  } catch (e) {
    /* ignore */
  }
}
