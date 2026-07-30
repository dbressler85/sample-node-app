# RevenueCat + Google Play — subscription setup checklist

Execution-ready steps to turn on paid Pro subscriptions for Dynasty Central. The **app code is
already wired** for RevenueCat (`mobile/src/entitlement/billing.js`); this doc is the dashboard +
store setup around it, plus the exact identifiers the code expects.

**Mental model:** Google Play collects the money and owns renewals/refunds/payouts (takes ~15%).
RevenueCat is a thin layer on top that (a) wraps the native billing SDK behind one clean call and
(b) is the source of truth for "is this user Pro right now?". RevenueCat never touches money.

> **Do this only after the data licenses are signed** (FantasyCalc commercial + RotoBaller partner).
> Charging while the app ships unlicensed third-party data is the real blocker, not the plumbing.

---

## Canonical identifiers (the code depends on these — match them exactly)

| Thing | Value | Where it lives |
|---|---|---|
| RevenueCat **entitlement** id | `pro` | `billing.js` → `ENTITLEMENT_ID` |
| Play **subscription** product id | `dynasty_pro` | Play Console |
| Base plan — annual | `annual` (billing period **P1Y**, $44.99) | Play Console |
| Base plan — monthly | `monthly` (billing period **P1M**, $7.99) | Play Console |
| RevenueCat **offering** | `default` | RevenueCat dashboard |
| RevenueCat packages | Annual + Monthly (map to the two base plans) | RevenueCat dashboard |
| App env — RC key | `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (a `goog_…` **public** key) | `eas.json` / EAS secret |
| App env — enforce | `EXPO_PUBLIC_ENFORCE_PRO=1` | `eas.json` (flip ON at go-live) |

The paywall maps RevenueCat's returned packages to the app's stable `annual` / `monthly` ids by
**billing period**, so the UI works regardless of the RC package identifiers — but keeping the names
above consistent avoids confusion.

---

## Prerequisites

- [ ] **Google Play Developer account** ($25 one-time) — https://play.google.com/console
- [ ] Merchant / **payments profile + banking + tax** set up in Play Console (so Google can pay you)
- [ ] **RevenueCat account** (free up to ~$2.5k/month tracked revenue) — https://app.revenuecat.com
- [ ] Data licenses signed (FantasyCalc, RotoBaller)
- [ ] The app's applicationId is `com.dynastycentral.app` (already set in `app.json`)

---

## Part A — Google Play Console (create the products)

1. [ ] Create the app in Play Console (name **Dynasty Central**, package `com.dynastycentral.app`).
   You need at least one uploaded build (an internal-testing AAB) before subscriptions can be tested.
2. [ ] **Monetize → Products → Subscriptions → Create subscription.**
   - Product ID: **`dynasty_pro`**
   - Name: "Dynasty Central Pro"
3. [ ] Add **two base plans** to that subscription (auto-renewing):
   - `annual` — billing period **Yearly (P1Y)**, price **$44.99** (Google auto-localizes to other currencies)
   - `monthly` — billing period **Monthly (P1M)**, price **$7.99**
4. [ ] **Activate** both base plans.
5. [ ] (Optional — we use an in-app no-card trial instead, see note) If you ever want a *store-managed*
   free trial, add a **free-trial offer** on the annual base plan. Our current design uses the app's own
   7-day reverse trial (no card up front), so you can skip this.
6. [ ] **Testing → License testing:** add your Google account (and any co-testers) as license testers so
   you can make **test purchases that don't charge a real card** and renew on an accelerated clock.

---

## Part B — RevenueCat (connect + map)

1. [ ] Create a **Project** in RevenueCat (e.g. "Dynasty Central").
2. [ ] **Add an app → Google Play Store.** Set the package name `com.dynastycentral.app`.
3. [ ] **Service account credentials** (so RevenueCat can verify purchases + receive renewal
   notifications from Google):
   - In **Google Cloud Console** for the Play project, create a **service account**, grant it access,
     and download the **JSON key**.
   - In **Play Console → Users & permissions**, invite that service account and grant **Financial
     data / “View financial data, orders, and cancellation survey responses”** + subscription
     management permissions.
   - Upload the JSON key into the RevenueCat app config. (RevenueCat's guide walks this exact flow.)
4. [ ] **Play → RevenueCat notifications:** in Play Console, set up **Real-time developer
   notifications (RTDN)** with the Pub/Sub topic RevenueCat gives you, so renewals/cancellations sync
   instantly. (Optional but recommended — without it RC still polls, just slower.)
5. [ ] **Entitlements → New:** identifier **`pro`**. This is the flag the app checks.
6. [ ] **Products:** import/attach the Play products `dynasty_pro:annual` and `dynasty_pro:monthly`,
   and **attach both to the `pro` entitlement.**
7. [ ] **Offerings → create `default`** with two **Packages**:
   - Annual package → `dynasty_pro:annual`
   - Monthly package → `dynasty_pro:monthly`
   Mark it the **current** offering.
8. [ ] **API keys → copy the Google/Android *public* SDK key** (starts with `goog_`). This is a
   publishable key — safe to ship in the client.

---

## Part C — App wiring (already done in code; you just supply the key)

The RevenueCat integration is implemented in `mobile/src/entitlement/billing.js` behind the same
interface the app already used, so nothing else changes. What's in place:

- `react-native-purchases` is a dependency; `configure()` initializes it with the key.
- `getCustomerInfo()` reads `entitlements.active.pro` → `subscribed`.
- `getOfferings()` returns the store's localized packages; `purchase()` runs the native purchase
  sheet; `restore()` restores prior purchases.
- **Guarded:** when `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` is unset (or the native module is absent, e.g.
  Expo Go), it falls back to the dev stub — so today's builds keep working untouched.

What **you** do:
1. [ ] Align the native version to your Expo SDK once, from `mobile/`:
   ```
   npx expo install react-native-purchases
   ```
   (This repo pins a working 8.x; `expo install` makes sure it matches your installed SDK exactly.)
2. [ ] Put the **`goog_…` public key** into the build env — either edit `mobile/eas.json`
   (`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`) or store it as an **EAS secret** of the same name.
3. [ ] Leave `EXPO_PUBLIC_ENFORCE_PRO` **unset** for now (gates stay inert while you test the flow).

---

## Part D — Test before charging anyone

1. [ ] Build an **internal-testing AAB** (`eas build -p android --profile production`) and upload it to
   the Play **Internal testing** track. RevenueCat/Play test purchases only work with a build
   installed from a Play track, signed with the same key — **not** a sideloaded local APK.
2. [ ] Install it as a **license tester** account.
3. [ ] Temporarily build with `EXPO_PUBLIC_ENFORCE_PRO=1` (or test the paywall via the Profile → Pro
   card) and confirm:
   - [ ] The paywall shows the **store-localized** prices from the `default` offering.
   - [ ] Buying the annual plan runs Google's purchase sheet and, on success, **unlocks** the gated
     actions (draft pick, file waiver, Set-All, propose/accept trade).
   - [ ] **Restore purchases** re-grants Pro on a reinstall.
   - [ ] Test renewals/cancellations (license-tester subs renew on an accelerated clock) reflect in the
     app within a short delay.

---

## Part E — Go live

1. [ ] Set `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (real key) **and** `EXPO_PUBLIC_ENFORCE_PRO=1` in the
   production build env.
2. [ ] `eas build -p android --profile production` → upload the AAB → roll out.
3. [ ] Confirm the subscription products are **active** and the `default` offering is **current**.
4. [ ] Watch the RevenueCat dashboard for the first live conversions.

---

## Comp yourself — don't subscribe to your own app

You do **not** need a paid subscription to use Pro. Set the backend env
**`PRO_WHITELIST="dbressler85"`** (comma-separated MFL usernames) in the Render dashboard. `/api/me`
then returns `pro:true` for those accounts and the app grants full access outright (reason `comped`),
independent of RevenueCat/Play. Add a friend by appending their MFL username — no app rebuild needed.
See `render.yaml` and `docs/DATA_SOURCES.md`.

---

## File map (what's where)

| Concern | File |
|---|---|
| Store/RevenueCat integration (this doc's target) | `mobile/src/entitlement/billing.js` |
| Tier logic (comped / subscribed / trial / free) | `mobile/src/entitlement/core.js` |
| Provider + `useEntitlement` + `useRequirePro` | `mobile/src/entitlement/index.js` |
| Paywall UI | `mobile/src/screens/PaywallScreen.js` |
| Enforcement flag + RC key | `mobile/src/config.js` (`ENFORCE_PRO`, `REVENUECAT_ANDROID_KEY`) |
| Comp whitelist (server) | `backend/src/config.js` (`proWhitelist`), `backend/src/routes/command.js` (`/api/me`) |
| Gated action sites | Draft / Waivers / Waiver+Lineup wizards / Lineup editor / Trades screens |
