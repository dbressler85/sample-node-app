'use strict';

const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  const mode = config.demoMode ? 'DEMO (fixture data)' : 'LIVE (MyFantasyLeague)';
  console.log(`Dynasty Central backend listening on :${config.port} — ${mode}, season ${config.season}`);
});
