# Dynasty Central — Mobile (Expo / React Native)

The Android app: log in once, see every MFL league's matchup, live score, record
and standing on one screen, and tap into any league to view your full roster.

## Configure the backend URL

The app calls **your** backend, set via an env var at start/build time:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 npm start
```

On a physical device, `localhost` is the phone itself — use your computer's LAN
IP or a hosted/tunnel URL.

## Run in development (fastest iteration — needs a computer)

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000 npx expo start
```

Install **Expo Go** from the Play Store, scan the QR code, and the app loads with
live reload. (After a fresh clone, run `npx expo install --fix` once so native
package versions line up with the Expo SDK.)

## Build an installable APK (no computer required)

Uses Expo's cloud builder (EAS):

1. Make a free account at [expo.dev](https://expo.dev) and generate an access token.
2. Add it as the GitHub repo secret `EXPO_TOKEN`.
3. Run the **Build Android APK (EAS)** workflow (Actions tab), passing your backend URL.
4. Open the resulting APK link on your phone, allow "install unknown apps", install.

Or locally: `npm install -g eas-cli && eas build -p android --profile preview`.

## Structure

```
App.js                 state-based screen router (login / dashboard / roster)
src/config.js          backend URL resolution
src/api.js             backend client
src/auth.js            secure token persistence (expo-secure-store)
src/screens/           LoginScreen, DashboardScreen, RosterScreen
src/components/         LeagueCard, PlayerRow
src/theme.js           shared dark-theme tokens
```

Navigation is intentionally a tiny state machine for this three-screen MVP;
when we add lineups/waivers/trades we'll move to `expo-router`.
