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
