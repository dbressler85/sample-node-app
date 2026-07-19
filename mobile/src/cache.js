import AsyncStorage from '@react-native-async-storage/async-storage';

// Tiny on-device cache for slow-changing data (league list, last-known statuses)
// so screens paint instantly from disk while fresh data loads in the background
// (stale-while-revalidate). Values are stored as { at, value }.
const PREFIX = 'dc_cache_';

export async function getEntry(key) {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export async function getValue(key) {
  const entry = await getEntry(key);
  return entry ? entry.value : null;
}

export async function setValue(key, value) {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
  } catch (e) {
    /* ignore cache write failures */
  }
}

export async function clearAll() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
  } catch (e) {
    /* ignore */
  }
}
