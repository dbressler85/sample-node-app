'use strict';

const app = require('./app');
const config = require('./config');
const persist = require('./store/persist');

const server = app.listen(config.port, () => {
  const mode = config.demoMode ? 'DEMO (fixture data)' : 'LIVE (MyFantasyLeague)';
  console.log(`Dynasty Central backend listening on :${config.port} — ${mode}, season ${config.season}`);
});

// Flush any pending durable state on shutdown so an in-flight debounced write
// isn't lost when the container stops or redeploys.
function shutdown(signal) {
  console.log(`\n${signal} received — flushing state and shutting down`);
  persist.flush();
  server.close(() => process.exit(0));
  // Don't hang forever if connections linger.
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
