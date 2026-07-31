# Beta bug reports

The white **bug** sign in the nav-tool cluster (on every main tab, next to Settings + Profile) opens a
report sheet: the user types what happened, a diagnostics snapshot is attached automatically, and it's
delivered to **your** inbox. The destination address lives **only** in a backend env var — it is never
sent to the app, so the APK can be inspected end-to-end without revealing your personal email.

## Flow

1. App → `POST /api/bug-report` with `{ message, diagnostics }` (session-authenticated).
2. `services/bugReport.js` formats it and calls `lib/mailer.js`.
3. Mailer delivers via whichever transport is configured (below). If none is set — or a send fails —
   the report is **persisted** server-side (`store/bugReports.js`, bounded to 50/user) so nothing is lost.

Diagnostics collected (client, `src/bugReport.js`): app version, platform + OS, device model, screen
size, the screen in view, entitlement tier, demo flag, and a rolling breadcrumb trail (recent screen
changes / caught errors). **No passwords** are ever included; the username is added server-side from the
session, so a report can't be spoofed to another account.

## Configure delivery (Render env — never commit these)

Set **one** transport. Neither is in the repo or the app.

**Option A — SMTP (e.g. a Gmail app password), most direct:**

```
BUG_SMTP_URL=smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com
BUG_REPORT_TO=you@gmail.com
BUG_REPORT_FROM=you@gmail.com   # optional; defaults to BUG_REPORT_TO
```

(Uses `nodemailer`, already a dependency. Gmail requires a 16-char **app password**, not your login.)

**Option B — Webhook (no SMTP; e.g. a Zapier/Make “Webhook → Email” relay):**

```
BUG_REPORT_WEBHOOK=https://hooks.example.com/your-hook
```

The backend POSTs the report JSON there; the relay forwards it to your inbox. With this option your
address lives in the relay, not even in the backend env.

## Until you configure a transport

Reports are stored server-side (delivered:false). Once you set either transport above and redeploy,
new reports deliver straight to you and nothing accumulates in the store.

## Turning it off after beta

Remove `<NavTools />`'s bug button by dropping the `openBugReport` handler from the `NavToolsProvider`
value in `App.js` (the button hides itself when its handler is absent), or gate it on a beta flag.
