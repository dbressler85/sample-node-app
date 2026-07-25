# Registering the MFL API client (User-Agent) for higher rate limits

MFL's Developer Program throttles the API **per source IP**. Unregistered clients get a baseline
limit; a **registered, SMS-validated client gets ~2.5× that limit**. There is **no API key** in this
model — the **User-Agent string _is_ the credential**. MFL matches the exact UA you register against
the UA header on your requests, so the two must be identical and the string must stay stable.

Our client already sends one UA on **every** MFL call (login + export + import), driven by
`MFL_USER_AGENT` (default `DynastyCentral/1.0`). Registration is a one-time manual step on MFL's site
plus two env vars in prod.

## One-time registration (owner)

1. Log in to MyFantasyLeague.com as an owner. From any of your leagues, open **Help → Developer's
   API**, then the **API Client Registration** page.
2. Register a client with **User-Agent = `DynastyCentral/1.0`** — the exact string in
   `config.userAgent` / `MFL_USER_AGENT`. (If you change it here, change it everywhere; registration
   is keyed to the exact string.)
3. **Validate**: MFL texts a code to your phone of record; enter it to finish validation.

## Turn it on in prod (Render → backend service → Environment)

4. Set:
   - `MFL_USER_AGENT=DynastyCentral/1.0`  ← must be byte-for-byte what you registered
   - `MFL_CLIENT_REGISTERED=true`         ← informational: unlocks the boot log + `/_metrics` flag
5. Redeploy.

## Verify prod is actually sending the registered UA

The common footgun is registering `DynastyCentral/1.0` but prod running the placeholder default
because the env var wasn't set. Confirm both:

- **Boot log**: `MFL client: User-Agent "DynastyCentral/1.0" — registered=true`
- **/_metrics** (send the `x-metrics-token` header):
  ```
  curl -s -H "x-metrics-token: $METRICS_TOKEN" https://<backend>/api/_metrics | jq .client
  # → { "userAgent": "DynastyCentral/1.0", "registered": true, "apiKeyConfigured": false }
  ```
  If `userAgent` here doesn't match what you registered, you're not getting the 2.5×.

## After validating, you may raise throughput

Defaults stay polite for an unregistered client. Once validated, you can push more concurrency and a
tighter stagger (the stagger, not concurrency, caps a cold fan-out's start rate):

- `MFL_MAX_CONCURRENT=8`
- `MFL_MIN_REQUEST_INTERVAL_MS=75`

The 429/503 backoff still pulls back automatically if MFL pushes, so raising these is safe to tune.

## Notes

- **Send the same UA everywhere.** Already handled server-side (`rawRequest` + `login`). When the
  device-origin reads land (each device calling MFL directly), those calls should send this **same
  registered UA** — and per MFL's own docs, mobile apps spread across users' IPs aren't subject to the
  shared-IP limit at all, so registration + device-origin compound.
- **Keep the UA stable.** A version/string change means re-registering and re-validating.
- **Best practices already implemented**: aggressive caching (static types once/day), a bounded
  throttle with request spacing, and no-retry backoff on 429 — the behaviors MFL asks for.
