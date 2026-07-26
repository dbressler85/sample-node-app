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
