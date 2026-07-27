import AsyncStorage from '@react-native-async-storage/async-storage';

// One-time "first run" flag for the welcome modal (device-level — once you've seen the intro, it stays
// gone). Non-sensitive, so plain AsyncStorage (not SecureStore). Best-effort: any storage error just
// means the intro might show again, never a crash.
const KEY = 'dc_welcome_seen_v1';

export async function hasSeenWelcome() {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch (e) {
    return false;
  }
}

export async function markWelcomeSeen() {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch (e) {
    /* non-fatal — worst case the intro shows again next launch */
  }
}
