'use strict';

// In-memory session store mapping an opaque app token -> MFL login state.
//
// The mobile app never sees the MFL cookie or password; it holds only this token
// and sends it as a Bearer credential. The backend swaps it for the MFL cookie
// on each request.
//
// NOTE (future work): this is process-memory only, so sessions are lost on
// restart and don't scale past one instance. Swap for Redis / encrypted DB before
// running this anywhere real or multi-user.

const crypto = require('crypto');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const sessions = new Map();

function create({ cookie, username }) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { cookie, username, createdAt: Date.now() });
  return token;
}

function get(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function destroy(token) {
  sessions.delete(token);
}

module.exports = { create, get, destroy };
