# Device-origin MFL reads — scaling the API layer past the shared backend

**Status:** Design / proposal. Not yet implemented. Supersedes nothing; complements the per-account
fair queue (#12) and the registered-User-Agent work (see `MFL_CLIENT_REGISTRATION.md`).

## The problem

Every MFL call today exits **one** Render backend IP. MFL rate-limits **per IP**, so the whole user
base shares a single rate budget. The throttle in `lib/mfl.js` (`penaltyUntil`, `effConcurrent`, the
fair queue) exists to ration that one pipe. As users grow, the per-user fan-out — each user has 15–20
leagues, and Home / portfolio / waivers / draft each fan out per league — sums onto that one IP. One
user's 429 is a per-IP signal, so it slows everyone. The load curve gets **worse** with scale.

## The insight (and MFL's own blessing)

MFL's Developer Program terms state the rate limits **"only apply on a per-IP address basis. So if
your client is spread across many users, it won't be affected by this. Thus mobile apps and calls from
within league pages should not [be] affected."**

If per-user reads originate from each user's **own device** (their own IP + own rate budget), users
flip from a shared cost into distributed capacity. The load curve **scales with itself** instead of
against itself. React Native is the enabler: it is **not a browser**, so its native `fetch` is not
subject to CORS or the cross-domain-file restriction that (correctly) blocks browser JS from calling
MFL cross-origin. (That restriction *would* apply to any future web build — see Risks.)

## Scope — a hybrid, not a wholesale move

### Move to the device: per-user **authenticated foreground reads**
The actual bottleneck. Not shareable between users, so nothing is lost by decentralizing, and this is
the load that scales linearly with users:
- rosters across leagues, pending trades, pending/looming waivers + FAAB balance
- my draft list, the live draft grid
- anything a screen fans out per-league for the logged-in user

### Keep on the backend
- **Global / static data** — player DB, NFL schedule, injuries, ADP. Identical for everyone and
  cached once server-side. Pushing it to every device would *increase* total MFL load and slow first
  paint. (MFL's own guidance: fetch the player DB at most once/day.)
- **Push-notification polling** — the notifications tick must hit MFL while the app is **backgrounded**
  to diff changes; a device can't. So the server keeps making *some* per-user calls — device-origin
  shrinks that load, it does not zero it.
- **Writes** — make pick, waiver claim, trade response, add/drop. Low volume, high stakes, and the
  backend already owns the hard-won correctness (franchise-id 4-digit padding, MFL error-detail
  surfacing, the `live_draft`/`import` command shapes). Not the bottleneck. `APIKEY` auth also can't
  do imports, which is a second reason writes stay cookie-authed on the backend.

## The three real costs

### 1. The read credential must live on the device
Today the backend holds the MFL session cookie (encrypted) and the device only gets an app token
(`mobile/src/auth.js`). Device-origin reads need a credential on-device:

- **Session cookie in SecureStore** — the general path. The cookie (`MFL_USER_ID`) is a bearer
  credential for the user's whole account, so it must live in **Expo SecureStore / Keychain / Keystore**
  (not AsyncStorage, which today backs `resourceStore`/`cache`), never be logged, and be wiped on
  logout (honor the existing logout-wipe UX guardrail). Note the cookie is Base64 and may contain
  `+ / =` — URL-escape when composing the header.
- **Read-only `APIKEY` (preferred if retrievable)** — MFL's `APIKEY` is **export-only (no writes),
  owner-only, scoped to one user/franchise/league**. That's a much lower-privilege thing to put on a
  device than the full cookie. Since writes stay on the backend, the device only needs read auth, so
  per-league read-only keys would be ideal. **Open question:** the terms say the key is exposed "via
  the `apiKey` JS variable when logged in," which implies it may only be scrapeable from a league
  page, not a clean export — needs a spike to confirm. If it isn't cleanly retrievable, fall back to
  the cookie.

Either way this is a deliberate **security-model change**. It is arguably *more* privacy-preserving
(the user's credential material stays on their own device for their own account rather than on our
server), but it must be designed, not stumbled into.

### 2. The parsing/correctness layer must be **shared**, not duplicated
All the hard-won MFL parsing lives in the backend (`lib/mflRepo.js` + services): `$t`-unwrap
(`mfl.text`/`num`), keeper handling, calendar `DRAFT_START` detection, franchise-id padding
(`mfl.fid`), waiver posture, draft-clock math. If the device fetches raw MFL exports it needs the same
parsing — and **two divergent copies is the failure mode to avoid**. Precedent exists: the trade-math
logic is already a shared client↔server module. The clean version extracts the read/parse layer into a
shared JS package both `backend/` and `mobile/` import. **This is the biggest lift** and where most of
the effort lives.

### 3. MFL obligations the on-device client must honor
From the terms — these become hard requirements for a device client, most of which the backend already
does and would be ported/shared:
- **Space requests** (~1s between calls). Port the throttle/stagger to the device.
- **Cache aggressively** (SWR via the existing on-device `resourceStore`/`cache`); keep the player DB
  server-side.
- **Do not retry on failure**; on `429`, back off (mirror `noteRateLimit`).
- **Send the registered User-Agent** on every device call (see `MFL_CLIENT_REGISTRATION.md`) — and
  per MFL, mobile apps spread across IPs are exempt from the shared-IP limit anyway, so registration +
  device-origin **compound**.
- Target the correct per-league host (MFL uses `wwwNN.myfantasyleague.com`, from the league's `url`);
  use `api.myfantasyleague.com` for non-league calls.

## How it compares to the alternatives

| Option | Adds bandwidth? | Cost / risk | Verdict |
|---|---|---|---|
| **Per-account fair queue (#12, done)** | No | Low | Isolates one user's latency from another. Interim win, not a scaling answer. |
| **Register the client UA (done)** | Raises the *shared* IP's ceiling ~2.5× | Trivial | Do it regardless; compounds with device-origin. |
| **Device-origin reads (this doc)** | **Yes — linear with users** | Medium–High (security + shared-package) | The real scaling lever. |
| Outbound proxy-IP pool on the backend | Yes | $$ + reads as limit-evasion to MFL | Device-origin is the "honest" version (real users' real IPs). |
| MFL commercial/API-key arrangement | Maybe | Business, not eng | Worth asking MFL; not mutually exclusive. |

## Recommended sequence

1. **Register the User-Agent** (done in code; needs the one-time SMS validation + env vars). Free 2.5×
   now, independent of everything else.
2. **Ship the per-account fair queue (#12, done).** Interim isolation while the bigger change is built.
3. **Validate the MFL side** (cheap, gates everything): confirm cookie-only reads work for each export
   type we fan out, and whether a read-only `APIKEY` is cleanly retrievable.
4. **Narrow spike:** pick **one** read path (e.g. the Home portfolio fan-out). Extract its parser into
   a shared package; put the read credential in SecureStore (cookie, or read-only key); have the device
   fetch+parse that one path directly from MFL behind a **feature flag**. Measure: MFL calls removed
   from the server, and on-device latency.
5. If it holds up, roll out read-path by read-path. The backend keeps global cache, push-polling, and
   writes throughout.

## Risks & open questions

- **Read-only APIKEY retrievability** (cost #1) — spike it; cookie is the fallback.
- **Shared-package divergence** (cost #2) — the whole point is one source of truth; treat the extract
  as the core work, not a side effect.
- **Push-polling still hits MFL per-user** — device-origin shrinks server load, doesn't eliminate it;
  size the backend accordingly.
- **A future web build cannot do this** — browser CORS + MFL's cross-domain rule block it. Device-origin
  is a native-app capability; a web client would route through the backend as today.
- **Cookie longevity / re-auth** — define how the device refreshes an expired cookie (silent re-login
  vs. prompt) and the logout-wipe path.
- **Abuse-pattern optics** — many app-originated calls should still be polite (spacing, caching, no
  retry, registered UA) so MFL doesn't see the *app* as a bad actor even though each device is under
  its own limit.

## Relationship to existing code

- `lib/mfl.js` — throttle, backoff, host allowlist, UA: the behaviors to **share** with the device.
- `lib/mflRepo.js` + `services/*` — the parsers to **extract** into the shared package.
- `mobile/src/api.js` — today talks only to the backend (`${API_URL}${path}`); would gain a direct-MFL
  path for the migrated reads, behind a flag.
- `mobile/src/auth.js`, `resourceStore.js`, `cache.js` — where the on-device credential + SWR cache
  live; SecureStore is the new dependency for the credential.
