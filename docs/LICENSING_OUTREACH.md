# Commercial-licensing outreach — FantasyCalc + RotoBaller

Ready-to-send emails requesting commercial-use permission for the two third-party data sources
Dynasty Central relies on, ahead of charging a subscription. Both are built around the same framing
that makes the ask easy: **their data stays free and attributed for every user; we never sell or
paywall it; we monetize only our own tooling; and we send traffic back to them.**

## How to use this

1. Fill the placeholders: **[Your name]**, **[your contact email]**. (App name is Dynasty Central,
   package `com.dynastycentral.app`, Android / Google Play, independent — already in the copy.)
2. Send them:
   - **FantasyCalc** — via the Contact link on fantasycalc.com (their Terms say "please contact
     FantasyCalc"); their X/Twitter is **@FantasyCalc** as a backup.
   - **RotoBaller** — via the contact on their partner page
     (rotoballer.com/fantasy-sports-player-news-feeds-and-apis) / their partnerships contact.
3. Keep a copy of any written reply — "express written permission" is the thing the FantasyCalc terms
   require, so the email thread *is* the agreement.

> Not legal advice — adjust wording to fit your situation. These are drafted to be honest, short, and
> easy to say yes to.

---

## Email 1 — FantasyCalc (commercial-use permission)

**To:** FantasyCalc (fantasycalc.com Contact page / @FantasyCalc)
**Subject:** Commercial-use permission request — Dynasty Central (values shown free + attributed)

Hi FantasyCalc team,

I'm [Your name], the developer of **Dynasty Central**, an independent Android app for managing
multiple MyFantasyLeague dynasty leagues from one place. It isn't affiliated with MFL, and it uses
your dynasty values (via `api.fantasycalc.com/values/current`, format-aware by QB count / PPR / league
size) to show market values throughout the app.

I'm writing to request **written permission for commercial use**, per your Terms of Use (§3a). The
important part: I'm adding a paid subscription, but **your values will stay 100% free and attributed
for every user — I will never sell or paywall them.** The subscription only unlocks my own tools
(lineup, waiver, and trade automation). Your data stays a free, credited feature, and the app acts as
a free distribution channel that sends traffic to you.

We already follow your terms:

- **Attribution** — a prominent, tappable "FantasyCalc.com" credit sits next to the values on every
  value-bearing screen, plus a persistent "Data & credits" entry.
- **Link-back** — that credit links to FantasyCalc.com.
- **Caching** — we cache server-side and refresh roughly twice a day per league format to minimize
  requests.
- **Non-endorsement** — the app clearly states it is not affiliated with or endorsed by FantasyCalc.

Two quick questions so we set this up exactly how you prefer:

1. For a paid app, what **refresh cadence** are you comfortable with — and roughly **when do your
   values publish** each day? Knowing that lets us time a single daily fetch to stay fresh without
   adding load.
2. Is there an **attribution format** (logo, exact wording, placement) you'd like us to use?

Happy to adjust anything to meet your requirements. Thanks for building such a great resource — the
dynasty community leans on it.

Best,
[Your name]
[your contact email]
Dynasty Central

---

## Email 2 — RotoBaller (partner feed + commercial use)

**To:** RotoBaller (partner / partnerships contact)
**Subject:** Partner feed + commercial-use inquiry — Dynasty Central (news attributed + deep-linked)

Hi RotoBaller team,

I'm [Your name], developer of **Dynasty Central**, an independent Android app for managing multiple
MyFantasyLeague dynasty leagues. I'd like to use **RotoBaller's partner news feed** as the
player-news source in the app, and to confirm terms for commercial use.

How it works on our side:

- We show NFL player news mapped to the players a user rosters across their leagues.
- **Attribution + traffic** — every news view carries a tappable "News · RotoBaller.com" credit, and
  each item **deep-links to its RotoBaller story**, so the feed drives readers straight to your site.
- The app is adding a paid subscription, but **news stays free and attributed for all users** — we
  monetize only our own tools. Your feed is a free, credited feature and a traffic channel to
  RotoBaller.

Could you share:

1. **Partner feed access** — the feed URL (RSS/XML or JSON) and any key, plus your partner terms.
2. **Confirmation** that commercial use in a paid app, with prominent attribution + link-back per your
   program, is fine.
3. Any **attribution wording / logo placement** you require.

We're launching on Android (Google Play) and are glad to meet whatever your partner program needs.
Thanks — RotoBaller powers the news for a lot of the tools we admire, and we'd like to do this the
right way.

Best,
[Your name]
[your contact email]
Dynasty Central

---

## After they reply

- **FantasyCalc:** if they grant permission and name a cadence/publish time, tighten
  `backend/src/lib/enrichment.js` (`FC_TTL_MS` + fetch timing) to match, and note the grant in
  `docs/DATA_SOURCES.md` (the ToU-compliance section).
- **RotoBaller:** set the feed URL they give you as `ROTOBALLER_FEED_URL` in the Render dashboard
  (never commit it — it may carry a partner key). See `render.yaml`.
- Only after **both** are in writing should you flip `EXPO_PUBLIC_ENFORCE_PRO=1` and start charging.
