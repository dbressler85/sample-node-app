'use strict';

// Durable fallback for beta bug reports we couldn't deliver (no transport configured, or a send that
// failed). Bounded per account so it can never grow unbounded — once email/webhook is configured in
// prod, delivery succeeds and nothing lands here. Keyed by account like the other per-user stores.

const crypto = require('crypto');
const persist = require('./persist');

const db = () => persist.ns('bugReports'); // token -> [report]
const MAX_PER_USER = 50;

function add(token, report) {
  const d = db();
  if (!d[token]) d[token] = [];
  const row = { id: crypto.randomUUID(), at: new Date().toISOString(), ...report };
  d[token].push(row);
  if (d[token].length > MAX_PER_USER) d[token].splice(0, d[token].length - MAX_PER_USER);
  persist.touch();
  return row;
}

function list(token) {
  const d = db();
  return d[token] ? d[token].map((r) => ({ ...r })) : [];
}

module.exports = { add, list };
