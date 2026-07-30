# Google Play — Data Safety form answers

Fill the Play Console **Data safety** section to match this. These answers reflect what the
app actually does (see the codebase + `docs/LESSONS.md` security rules); keep them true if the
data flows change. The guiding facts:

- The user's **MFL password is never stored** — it flows app → our backend → MyFantasyLeague
  to sign in, and only the resulting **session cookie** is kept (encrypted at rest when
  `SESSION_SECRET` is set). Treat the password as *transmitted, not collected/stored*.
- We keep the **MFL username** (account identifier) and a **push token** to route notifications.
- No ads, no analytics SDKs, no location, no contacts, no photos/media, no financial data.
- All network traffic is **HTTPS** (encrypted in transit).

---

## Top-level

- **Does your app collect or share any of the required user data types?** → **Yes**
- **Is all of the user data collected by your app encrypted in transit?** → **Yes**
- **Do you provide a way for users to request that their data be deleted?** → **Yes**
  (Logging out wipes the stored session; account/data deletion on request via the support
  contact in the privacy policy.)

## Data types

### 1. Personal info → **User IDs**
- **Collected:** Yes · **Shared:** No
- **Processed ephemerally:** No (the MFL username is retained with the session)
- **Required or optional:** Required
- **Purpose:** App functionality (authenticate to MyFantasyLeague; identify the signed-in
  manager across leagues)

### 2. App activity → **Other user-generated content** (draft lists, trade blocks, tags,
watchlist, waiver claims)
- **Collected:** Yes · **Shared:** No
- **Required or optional:** Optional (created only when the user takes those actions)
- **Purpose:** App functionality

### 3. Device or other IDs → **Device or other IDs** (Expo / FCM push token)
- **Collected:** Yes · **Shared:** Yes
- **Shared with:** Google (Firebase Cloud Messaging) and Expo's push service, **only to
  route the notifications you opt into** — not for advertising or analytics.
- **Required or optional:** Optional (only if the user enables notifications)
- **Purpose:** App functionality (deliver push notifications)

## NOT collected (leave unchecked)
Location · Financial info · Health/fitness · Messages · Photos/videos · Audio · Contacts ·
Calendar · Web browsing history · Installed apps · **Analytics** · **Advertising/marketing**.

## Note on the MFL password
Google's form has no "credential transmitted but not stored" category. Because we do **not
retain** the password (only the derived session cookie), it is **not** declared as collected
data. If a reviewer asks, the accurate statement is: *"The MyFantasyLeague password is
transmitted over HTTPS solely to obtain a session token from MyFantasyLeague and is never
persisted by the app or its backend."* This is documented in the privacy policy.

## Session cookie
The stored MFL **session cookie** is the mechanism behind the "User IDs" declaration — it is
retained (encrypted at rest) to keep the user signed in, used only for App functionality, and
never shared. It is cleared on logout.
