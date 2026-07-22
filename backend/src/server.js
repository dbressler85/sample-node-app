'use strict';

const app = require('./app');
const config = require('./config');
const persist = require('./store/persist');
const notifications = require('./services/notifications');

// Demo mode accepts ANY credentials and mints a working token (fixture data only). That's
// correct for local/demo, but shipping it to production would be an open door — so make it
// impossible to do silently: shout on every boot, and refuse to start if NODE_ENV=production.
if (config.demoMode && process.env.NODE_ENV === 'production') {
  console.error('FATAL: MFL_DEMO_MODE is ON while NODE_ENV=production — demo mode accepts any login. Set MFL_DEMO_MODE=false. Refusing to start.');
  process.exit(1);
}

const server = app.listen(config.port, () => {
  const mode = config.demoMode ? 'DEMO (fixture data)' : 'LIVE (MyFantasyLeague)';
  if (config.demoMode) console.warn('⚠️  DEMO MODE: any username/password is accepted and returns fixture data. Do not expose publicly.');
  console.log(`Dynasty Central backend listening on :${config.port} — ${mode}, season ${config.season}`);
});

// Push-notification scheduler: poll registered devices for new on-the-clock /
// trade-offer events and push them. No-ops until a device registers. Errors are
// swallowed so a bad tick never crashes the server.
const NOTIFY_MS = Number(process.env.NOTIFY_INTERVAL_MS) || 45000;
const notifyTimer = setInterval(() => { notifications.tick().catch(() => {}); }, NOTIFY_MS);
notifyTimer.unref();

// Flush any pending durable state on shutdown so an in-flight debounced write
// isn't lost when the container stops or redeploys.
function shutdown(signal) {
  console.log(`\n${signal} received — flushing state and shutting down`);
  clearInterval(notifyTimer);
  persist.flush();
  server.close(() => process.exit(0));
  // Don't hang forever if connections linger.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
