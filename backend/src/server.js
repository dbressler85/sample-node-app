'use strict';

const app = require('./app');
const config = require('./config');
const persist = require('./store/persist');
const notifications = require('./services/notifications');
const warm = require('./services/warm');

// Demo mode accepts ANY credentials and mints a working token (fixture data only). That's
// correct for local/demo, but shipping it to production would be an open door — so make it
// impossible to do silently: shout on every boot, and refuse to start if NODE_ENV=production.
if (config.demoMode && process.env.NODE_ENV === 'production') {
  console.error('FATAL: MFL_DEMO_MODE is ON while NODE_ENV=production — demo mode accepts any login. Set MFL_DEMO_MODE=false. Refusing to start.');
  process.exit(1);
}

// Resilience net: on Node ≥15 an unhandled promise rejection (e.g. a detached MFL read that
// rejects) crashes the process with exit 1 — which is exactly how a single bad code path took the
// whole API down. Log it with a full stack and KEEP SERVING; request handlers still catch their
// own errors, this only stops one stray rejection from being a full outage. Same for a truly
// uncaught exception — log it rather than crash-loop (an operator can spot it in the logs).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', (reason && reason.stack) || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', (err && err.stack) || err);
});

const server = app.listen(config.port, () => {
  const mode = config.demoMode ? 'DEMO (fixture data)' : 'LIVE (MyFantasyLeague)';
  if (config.demoMode) console.warn('⚠️  DEMO MODE: any username/password is accepted and returns fixture data. Do not expose publicly.');
  console.log(`Dynasty Central backend listening on :${config.port} — ${mode}, season ${config.season}`);
  // Surface the MFL client identity so it's verifiable that prod is sending the REGISTERED User-Agent
  // (a mismatch silently forfeits the ~2.5x validated-client rate limit). Also visible on /_metrics.
  if (!config.demoMode) {
    console.log(`MFL client: User-Agent "${config.userAgent}" — registered=${config.mflClientRegistered}`);
    if (!config.mflClientRegistered) {
      console.log('  ↳ not registered: register + SMS-validate this exact UA for ~2.5x limits, then set MFL_CLIENT_REGISTERED=true. See docs/MFL_CLIENT_REGISTRATION.md');
    }
  }
});

// Push-notification scheduler: poll registered devices for new on-the-clock /
// trade-offer events and push them. No-ops until a device registers. Errors are
// swallowed so a bad tick never crashes the server.
const NOTIFY_MS = Number(process.env.NOTIFY_INTERVAL_MS) || 45000;
const notifyTimer = setInterval(() => { notifications.tick().catch(() => {}); }, NOTIFY_MS);
notifyTimer.unref();

// Sunday pre-warm worker: keep active users' lineup reads warm through the game-day window. Live
// (non-demo) mode only — it makes real MFL calls with real session cookies.
if (config.warmEnabled && !config.demoMode) warm.start();

// Flush any pending durable state on shutdown so an in-flight debounced write
// isn't lost when the container stops or redeploys.
function shutdown(signal) {
  console.log(`\n${signal} received — flushing state and shutting down`);
  clearInterval(notifyTimer);
  warm.stop();
  persist.flushSync(); // sync: the process is exiting, an async write wouldn't finish
  server.close(() => process.exit(0));
  // Don't hang forever if connections linger.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
